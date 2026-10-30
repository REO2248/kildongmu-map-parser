//! Key derivation replicated from libshdatakeyservice.so.

use crate::crijndael::Rijndael;

pub const MAP_PREFIX: &str = "5MgQ7qa2d2Ia9LaDfo7nl2i46ui9d2Ia7qa2f112";

const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghijklmnopqrstuvwxyz";
const RW_KEY: &[u8] = b"abcdefghijklmnopqrstuvwxyzabcdef";

fn b64_wrap(data: &[u8]) -> String {
    use base64::Engine;
    let s = base64::engine::general_purpose::STANDARD_NO_PAD.encode(data);
    let mut out = String::with_capacity(s.len() + s.len() / 76 + 1);
    for chunk in s.as_bytes().chunks(76) {
        out.push_str(std::str::from_utf8(chunk).unwrap());
        out.push('\n');
    }
    out
}

pub fn plaintext(name: &str) -> String {
    let mut v = ALPHABET.to_vec();
    v.extend_from_slice(name.as_bytes());
    v.reverse();
    b64_wrap(&v)
}

fn derive_with_key(key: &[u8], name: &str) -> String {
    let pt = plaintext(name);
    let pb = pt.as_bytes();
    let mut block = [0u8; 64];
    let take = pb.len().min(64);
    block[..take].copy_from_slice(&pb[..take]);
    let ct = Rijndael::new(key).encrypt_ecb(&block);
    let end = ct.iter().position(|&b| b == 0).unwrap_or(ct.len());
    b64_wrap(&ct[..end])
}

pub fn city_key(name: &str) -> String {
    derive_with_key(RW_KEY, name)
}

pub fn geo_key(product_id: i32) -> String {
    let repeated = format!("id:{}", product_id.saturating_mul(100)).repeat(10);
    let key = &repeated.as_bytes()[..32];
    derive_with_key(key, "geo.db")
}

fn crypt_token(c: char) -> &'static str {
    match c {
        '.' => "cvb6",
        '9' => "tcNt",
        '0' => "n3G4", '1' => "03T6", '2' => "nlre", '3' => "turn", '4' => "void",
        '5' => "erdi", '6' => "spat", '7' => "chzO", '8' => "bjec",
        'A' => "vbre", 'B' => "ERS1", 'C' => "2fun", 'D' => "ctio", 'E' => "nna4",
        'F' => "5ifm", 'G' => "aqty", 'H' => "peOU", 'I' => "Lwam", 'J' => "qvar",
        'K' => "n3Ob", 'L' => "ject", 'M' => "eRea", 'N' => "rty3", 'O' => "payl",
        'P' => "oadt", 'Q' => "yuda", 'R' => "taui", 'S' => "re2s", 'T' => "pons",
        'U' => "ea2g", 'V' => "stat", 'W' => "ush5", 'X' => "2ajU", 'Y' => "ifk4",
        'Z' => "0aeE",
        'a' => "aq27", 'b' => "w2kA", 'c' => "ae10", 'd' => "1rS4", 'e' => "at33",
        'f' => "yBT2", 'g' => "au99", 'h' => "iLD6", 'i' => "ao90", 'j' => "pVE2",
        'k' => "aa13", 'l' => "51sB", 'm' => "I2ad", 'n' => "724f", 'o' => "1RJa",
        'p' => "g125", 'q' => "1hKL", 'r' => "aj8k", 's' => "1MQf", 't' => "unct",
        'u' => "ionl", 'v' => "e2zr", 'w' => "etur", 'x' => "ncfu", 'y' => "ncti",
        'z' => "onxt",
        _ => "",
    }
}

/// mbgl::util::crypt: per-char substitution to 4-char tokens, then 4-byte transposition.
pub fn crypt(s: &str) -> String {
    let mut c = String::new();
    for ch in s.chars() {
        c.push_str(crypt_token(ch));
    }
    let b = c.as_bytes();
    let l = b.len();
    let mut out = Vec::with_capacity(l);
    for k in 0..l / 4 {
        let p = (l >> 2) - 1 - k;
        out.push(b[p * 4 + 3]);
        out.push(b[4 * k + 1]);
        out.push(b[p * 4]);
        out.push(b[4 * k + 2]);
    }
    String::from_utf8(out).unwrap()
}

pub fn map_key(name: &str) -> String {
    format!("{}{}", MAP_PREFIX, crypt(name))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn city_key_kanggye() {
        assert_eq!(
            city_key("kanggye"),
            "0JmSdvs3jwLEFBDnCclL4egZS+ev7Mj9XfsE7RYysMxc9sPtX2RWLurVYJ4zaCpPGZfRIfsDK/UG\nDurBNslsng\n"
        );
    }

    #[test]
    fn geo_key_kanggye() {
        assert_eq!(
            geo_key(40388),
            "RP88dc4/WaWecT87QTPzK/tx8s+4StRslLDDfNS9Pob6NJsVrtR3P+FQAj6f6zkF03swcW0EY5SE\nnKuBwh4fUQ\n"
        );
    }

    #[test]
    fn map_key_kanggye() {
        assert_eq!(
            map_key("kanggye"),
            "5MgQ7qa2d2Ia9LaDfo7nl2i46ui9d2Ia7qa2f1123aa1iqn292a49ua9fu797cat3ta3"
        );
    }

    #[test]
    fn crypt_hyesan() {
        assert_eq!(crypt("hyesan"), "fL7D7catft133MaQiqn262i4");
    }
}
