//! City data container: BE u32 version, BE u32 entry count, then entries of
//! BE u32 name length (UTF-16 code units) + UTF-16BE name + size + blob.
//! Some distributions write the size as a 4-byte int, others as an 8-byte
//! long (what the app's own reader expects), so both widths are accepted.
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

/// Size of the NATISIGN trailer that follows the last entry.
const TRAILER: usize = 753;

fn be_u32(data: &[u8], off: usize) -> Option<u32> {
    data.get(off..off + 4)
        .map(|b| u32::from_be_bytes([b[0], b[1], b[2], b[3]]))
}

fn be_size(data: &[u8], off: usize, width: usize) -> Option<u64> {
    if width == 4 {
        be_u32(data, off).map(u64::from)
    } else {
        data.get(off..off + 8).map(|b| {
            u64::from_be_bytes([b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7]])
        })
    }
}

fn parse_with(data: &[u8], width: usize) -> Result<Container, ContainerError> {
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
        let size = be_size(data, pos, width).ok_or(ContainerError::Truncated)?;
        pos += width;
        let size = usize::try_from(size).map_err(|_| ContainerError::Truncated)?;
        let blob = data.get(pos..pos + size).ok_or(ContainerError::Truncated)?;
        pos += size;
        entries.push(Entry { name, data: blob.to_vec() });
    }
    // Nothing but the signature trailer may follow the last entry; the wrong
    // size width almost always overruns here or misaligns the UTF-16 names.
    let remaining = data.len() - pos;
    if remaining != 0 && remaining != TRAILER {
        return Err(ContainerError::Truncated);
    }
    Ok(Container { version, entries })
}

impl Container {
    pub fn parse(data: &[u8]) -> Result<Container, ContainerError> {
        let mut first = None;
        for width in [4usize, 8] {
            match parse_with(data, width) {
                Ok(c) => return Ok(c),
                Err(e) => {
                    if first.is_none() {
                        first = Some(e);
                    }
                }
            }
        }
        Err(first.unwrap_or(ContainerError::Truncated))
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

    fn build(width: usize, trailer: bool) -> Vec<u8> {
        let mut buf = Vec::new();
        buf.extend_from_slice(&2u32.to_be_bytes());
        buf.extend_from_slice(&2u32.to_be_bytes());
        for (name, blob) in [("/geo.db", &b"GEO"[..]), ("/kanggye.db", &b"CITY"[..])] {
            let units: Vec<u16> = name.encode_utf16().collect();
            buf.extend_from_slice(&(units.len() as u32).to_be_bytes());
            for u in &units {
                buf.extend_from_slice(&u.to_be_bytes());
            }
            let size = (blob.len() as u64).to_be_bytes();
            if width == 4 {
                buf.extend_from_slice(&size[4..]);
            } else {
                buf.extend_from_slice(&size);
            }
            buf.extend_from_slice(blob);
        }
        if trailer {
            buf.extend(std::iter::repeat(0).take(TRAILER));
        }
        buf
    }

    #[test]
    fn parses_nominal_layout() {
        let c = Container::parse(&build(4, false)).unwrap();
        assert_eq!(c.version, 2);
        assert_eq!(c.names(), vec!["/geo.db", "/kanggye.db"]);
        assert_eq!(c.city_entry().unwrap().data, b"CITY");
        assert_eq!(c.alias().unwrap(), "kanggye");
    }

    #[test]
    fn parses_eight_byte_sizes_with_trailer() {
        let c = Container::parse(&build(8, true)).unwrap();
        assert_eq!(c.names(), vec!["/geo.db", "/kanggye.db"]);
        assert_eq!(c.find("/geo.db").unwrap().data, b"GEO");
    }

    #[test]
    fn rejects_trailing_garbage() {
        let mut buf = build(4, false);
        buf.extend_from_slice(b"junk");
        assert!(Container::parse(&buf).is_err());
    }
}
