//! City data container: BE u32 version, BE u32 entry count, then entries of
//! BE u32 name length (UTF-16 code units) + UTF-16BE name + BE u32 size + blob.
//! A 753-byte NATISIGN trailer follows the last entry.

#[derive(Debug)]
pub struct Entry {
    pub name: String,
    pub data: Vec<u8>,
}

#[derive(Debug)]
pub struct Container {
    pub version: u32,
    pub entries: Vec<Entry>,
}

#[derive(Debug)]
pub enum ContainerError {
    Truncated,
    BadUtf16,
}

impl std::fmt::Display for ContainerError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ContainerError::Truncated => write!(f, "container is truncated"),
            ContainerError::BadUtf16 => write!(f, "container name is not valid UTF-16"),
        }
    }
}

fn be_u32(data: &[u8], off: usize) -> Option<u32> {
    data.get(off..off + 4)
        .map(|b| u32::from_be_bytes([b[0], b[1], b[2], b[3]]))
}

impl Container {
    pub fn parse(data: &[u8]) -> Result<Container, ContainerError> {
        if data.len() < 8 {
            return Err(ContainerError::Truncated);
        }
        let version = be_u32(data, 0).ok_or(ContainerError::Truncated)?;
        let count = be_u32(data, 4).ok_or(ContainerError::Truncated)?;
        // Guard against absurd counts on corrupt input.
        if count as usize > data.len() / 8 {
            return Err(ContainerError::Truncated);
        }
        let mut pos = 8usize;
        let mut entries = Vec::with_capacity(count as usize);
        for _ in 0..count {
            let nlen = be_u32(data, pos).ok_or(ContainerError::Truncated)? as usize;
            pos += 4;
            let byte_len = nlen.checked_mul(2).ok_or(ContainerError::Truncated)?;
            let raw = data.get(pos..pos + byte_len).ok_or(ContainerError::Truncated)?;
            pos += byte_len;
            let units: Vec<u16> = raw
                .chunks_exact(2)
                .map(|c| u16::from_be_bytes([c[0], c[1]]))
                .collect();
            let name = String::from_utf16(&units).map_err(|_| ContainerError::BadUtf16)?;
            let size = be_u32(data, pos).ok_or(ContainerError::Truncated)? as usize;
            pos += 4;
            let blob = data.get(pos..pos + size).ok_or(ContainerError::Truncated)?;
            pos += size;
            entries.push(Entry { name, data: blob.to_vec() });
        }
        Ok(Container { version, entries })
    }

    pub fn find(&self, name: &str) -> Option<&Entry> {
        self.entries.iter().find(|e| e.name == name)
    }

    pub fn names(&self) -> Vec<&str> {
        self.entries.iter().map(|e| e.name.as_str()).collect()
    }

    /// The city database entry is the one whose name is not geo.db / map.db.
    pub fn city_entry(&self) -> Option<&Entry> {
        self.entries
            .iter()
            .find(|e| {
                e.name.ends_with(".db") && e.name != "/geo.db" && e.name != "/map.db"
            })
            .or_else(|| self.entries.iter().find(|e| e.name.ends_with(".db")))
    }

    pub fn alias(&self) -> Option<String> {
        self.city_entry().and_then(|e| {
            let base = e.name.trim_end_matches(".db").rsplit('/').next()?;
            Some(base.to_string())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_nominal_layout() {
        let mut buf = Vec::new();
        buf.extend_from_slice(&2u32.to_be_bytes());
        buf.extend_from_slice(&2u32.to_be_bytes());
        for (name, blob) in [("/geo.db", &b"GEO"[..]), ("/kanggye.db", &b"CITY"[..])] {
            let units: Vec<u16> = name.encode_utf16().collect();
            buf.extend_from_slice(&(units.len() as u32).to_be_bytes());
            for u in &units {
                buf.extend_from_slice(&u.to_be_bytes());
            }
            buf.extend_from_slice(&(blob.len() as u32).to_be_bytes());
            buf.extend_from_slice(blob);
        }
        let c = Container::parse(&buf).unwrap();
        assert_eq!(c.version, 2);
        assert_eq!(c.names(), vec!["/geo.db", "/kanggye.db"]);
        assert_eq!(c.city_entry().unwrap().data, b"CITY");
        assert_eq!(c.alias().unwrap(), "kanggye");
    }
}
