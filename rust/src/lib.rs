//! WASM bindings for the Kildongmu city data package.

use wasm_bindgen::prelude::*;

mod codec;
mod container;
mod crijndael;
mod geom;
mod keys;

pub const DEFAULT_ITERATIONS: u32 = 12345;

fn js_err<E: std::fmt::Display>(e: E) -> JsValue {
    JsValue::from_str(&e.to_string())
}

#[wasm_bindgen]
pub fn derive_city_key(alias: &str) -> String {
    keys::city_key(alias)
}

#[wasm_bindgen]
pub fn derive_geo_key(product_id: i32) -> String {
    keys::geo_key(product_id)
}

#[wasm_bindgen]
pub fn derive_map_key(alias: &str) -> String {
    keys::map_key(alias)
}

/// Decode one SpatiaLite geometry blob to a GeoJSON geometry JSON string.
#[wasm_bindgen]
pub fn decode_geometry(blob: &[u8]) -> Option<String> {
    geom::decode_geometry(blob).map(|v| v.to_string())
}

#[wasm_bindgen]
pub struct Package {
    inner: container::Container,
}

#[wasm_bindgen]
impl Package {
    #[wasm_bindgen(constructor)]
    pub fn new(data: &[u8]) -> Result<Package, JsValue> {
        let inner = container::Container::parse(data).map_err(js_err)?;
        Ok(Package { inner })
    }

    #[wasm_bindgen(getter)]
    pub fn version(&self) -> u32 {
        self.inner.version
    }

    /// City name used to derive the key, taken from the city db entry name.
    #[wasm_bindgen(getter)]
    pub fn alias(&self) -> Option<String> {
        self.inner.alias()
    }

    /// Entry names as a JSON array of strings.
    pub fn names(&self) -> String {
        serde_json::to_string(&self.inner.names()).unwrap_or_else(|_| "[]".into())
    }

    pub fn has(&self, name: &str) -> bool {
        self.inner.find(name).is_some()
    }

    pub fn entry(&self, name: &str) -> Option<Vec<u8>> {
        self.inner.find(name).map(|e| e.data.clone())
    }

    pub fn decrypt(&self, name: &str, passphrase: &str, iterations: u32) -> Result<Vec<u8>, JsValue> {
        let entry = self.inner.find(name).ok_or_else(|| JsValue::from_str("entry not found"))?;
        codec::decrypt_db_file(&entry.data, passphrase, iterations).map_err(js_err)
    }

    pub fn city_db(&self, iterations: u32) -> Result<Vec<u8>, JsValue> {
        let alias = self.inner.alias().ok_or_else(|| JsValue::from_str("city entry not found"))?;
        let entry = self.inner.city_entry().ok_or_else(|| JsValue::from_str("city entry not found"))?;
        codec::decrypt_db_file(&entry.data, &keys::city_key(&alias), iterations).map_err(js_err)
    }

    pub fn geo_db(&self, product_id: i32, iterations: u32) -> Result<Vec<u8>, JsValue> {
        let entry = self.inner.find("/geo.db").ok_or_else(|| JsValue::from_str("geo.db not found"))?;
        codec::decrypt_db_file(&entry.data, &keys::geo_key(product_id), iterations).map_err(js_err)
    }

    pub fn map_db(&self, iterations: u32) -> Result<Vec<u8>, JsValue> {
        let alias = self.inner.alias().ok_or_else(|| JsValue::from_str("city entry not found"))?;
        let entry = self.inner.find("/map.db").ok_or_else(|| JsValue::from_str("map.db not found"))?;
        codec::decrypt_db_file(&entry.data, &keys::map_key(&alias), iterations).map_err(js_err)
    }

    pub fn city_key(&self) -> Option<String> {
        self.inner.alias().map(|a| keys::city_key(&a))
    }

    pub fn map_key(&self) -> Option<String> {
        self.inner.alias().map(|a| keys::map_key(&a))
    }
}

/// Native smoke test against the real sample package (skipped when missing).
#[cfg(test)]
mod tests {
    use super::*;

    fn sample(name: &str) -> Option<Vec<u8>> {
        let p = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../work/deep/kanggye_dat")
            .join(name);
        std::fs::read(p).ok()
    }

    #[test]
    fn decrypts_real_package() {
        let dat = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../cities_kanggye.dat");
        let Ok(raw) = std::fs::read(dat) else { return };
        let pkg = Package::new(&raw).unwrap();
        assert_eq!(pkg.alias().as_deref(), Some("kanggye"));
        for (name, db) in [
            ("/geo.db", pkg.geo_db(40388, DEFAULT_ITERATIONS).unwrap()),
            ("/kanggye.db", pkg.city_db(DEFAULT_ITERATIONS).unwrap()),
            ("/map.db", pkg.map_db(DEFAULT_ITERATIONS).unwrap()),
        ] {
            assert_eq!(&db[0..16], b"SQLite format 3\0", "{name} magic");
            let expect = sample(&format!("{}.dec", &name[1..])).unwrap();
            assert_eq!(db, expect, "{name} content");
        }
    }

    #[test]
    fn decodes_real_geometry() {
        let Some(db) = sample("geo.db.dec") else { return };
        // Search page data for a known geometry blob: class field right after 0x7C.
        let mut found = 0;
        for i in 0..db.len().saturating_sub(60) {
            if db[i] == 0x00 && db[i + 1] == 0x01 && db[i + 38] == 0x7C {
                let cls = u32::from_le_bytes(db[i + 39..i + 43].try_into().unwrap());
                if (1..=6).contains(&cls) {
                    if let Some(g) = geom::decode_geometry(&db[i..]) {
                        assert!(g["type"].is_string());
                        found += 1;
                        if found > 3 {
                            break;
                        }
                    }
                }
            }
        }
        assert!(found > 0);
    }
}
