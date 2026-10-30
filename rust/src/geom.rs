//! Decoder for the geometry blobs stored in geo.db (libjsqlite internal
//! SpatiaLite BLOB form) into GeoJSON geometry objects.
//!
//! Layout: [0]=0x00, [1]=endian, [2:6]=SRID, [6:38]=MBR, [38]=0x7C,
//! [39:43]=class, then:
//!   class 1 POINT:             x,y f64
//!   class 5 MULTILINESTRING:   count, per part 0x69, type=2, npts, points
//!   class 6 MULTIPOLYGON:      count, per poly 0x69, type=3, nrings, per ring npts, points

use serde_json::{json, Value};

fn u32_at(b: &[u8], off: usize) -> Option<u32> {
    b.get(off..off + 4)
        .map(|s| u32::from_le_bytes([s[0], s[1], s[2], s[3]]))
}

fn f64_at(b: &[u8], off: usize) -> Option<f64> {
    b.get(off..off + 8)
        .map(|s| f64::from_le_bytes(s.try_into().unwrap()))
}

fn read_points(b: &[u8], mut off: usize) -> Option<(Vec<Value>, usize)> {
    let n = u32_at(b, off)? as usize;
    off += 4;
    let bytes = n.checked_mul(16)?;
    if off + bytes > b.len() {
        return None;
    }
    let mut pts = Vec::with_capacity(n);
    for _ in 0..n {
        let x = f64_at(b, off)?;
        let y = f64_at(b, off + 8)?;
        pts.push(json!([x, y]));
        off += 16;
    }
    Some((pts, off))
}

pub fn decode_geometry(blob: &[u8]) -> Option<Value> {
    if blob.len() < 43 || blob[0] != 0 {
        return None;
    }
    if blob[38] != 0x7C && blob[38] != 0x01 {
        return None;
    }
    let cls = u32_at(blob, 39)?;
    let mut off = 43usize;
    match cls {
        1 => {
            let x = f64_at(blob, off)?;
            let y = f64_at(blob, off + 8)?;
            Some(json!({"type": "Point", "coordinates": [x, y]}))
        }
        5 => {
            let cnt = u32_at(blob, off)? as usize;
            off += 4;
            let mut lines = Vec::with_capacity(cnt);
            for _ in 0..cnt {
                if *blob.get(off)? != 0x69 {
                    return None;
                }
                if u32_at(blob, off + 1)? != 2 {
                    return None;
                }
                off += 5;
                let (pts, next) = read_points(blob, off)?;
                off = next;
                lines.push(Value::Array(pts));
            }
            let typ = if lines.len() == 1 { "LineString" } else { "MultiLineString" };
            let coords = if lines.len() == 1 { lines.pop().unwrap() } else { Value::Array(lines) };
            Some(json!({"type": typ, "coordinates": coords}))
        }
        6 => {
            let cnt = u32_at(blob, off)? as usize;
            off += 4;
            let mut polys = Vec::with_capacity(cnt);
            for _ in 0..cnt {
                if *blob.get(off)? != 0x69 {
                    return None;
                }
                if u32_at(blob, off + 1)? != 3 {
                    return None;
                }
                off += 5;
                let nrings = u32_at(blob, off)? as usize;
                off += 4;
                let mut rings = Vec::with_capacity(nrings);
                for _ in 0..nrings {
                    let (pts, next) = read_points(blob, off)?;
                    off = next;
                    rings.push(Value::Array(pts));
                }
                polys.push(Value::Array(rings));
            }
            let typ = if polys.len() == 1 { "Polygon" } else { "MultiPolygon" };
            let coords = if polys.len() == 1 { polys.pop().unwrap() } else { Value::Array(polys) };
            Some(json!({"type": typ, "coordinates": coords}))
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn build_header() -> Vec<u8> {
        let mut b = vec![0u8; 43];
        b[1] = 1;
        b[2..6].copy_from_slice(&4326u32.to_le_bytes());
        b[38] = 0x7C;
        b
    }

    #[test]
    fn point() {
        let mut b = build_header();
        b[39..43].copy_from_slice(&1u32.to_le_bytes());
        b.extend_from_slice(&12.5f64.to_le_bytes());
        b.extend_from_slice(&34.25f64.to_le_bytes());
        let g = decode_geometry(&b).unwrap();
        assert_eq!(g, json!({"type": "Point", "coordinates": [12.5, 34.25]}));
    }

    #[test]
    fn line() {
        let mut b = build_header();
        b[39..43].copy_from_slice(&5u32.to_le_bytes());
        b.extend_from_slice(&1u32.to_le_bytes());
        b.push(0x69);
        b.extend_from_slice(&2u32.to_le_bytes());
        b.extend_from_slice(&2u32.to_le_bytes());
        for (x, y) in [(1.0f64, 2.0f64), (3.0f64, 4.0f64)] {
            b.extend_from_slice(&x.to_le_bytes());
            b.extend_from_slice(&y.to_le_bytes());
        }
        let g = decode_geometry(&b).unwrap();
        assert_eq!(g["type"], "LineString");
        assert_eq!(g["coordinates"][1][0], 3.0);
    }
}
