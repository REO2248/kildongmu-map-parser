//! jsqlite page codec: PBKDF2-HMAC-SHA256 + ChaCha20 + Poly1305, 4096-byte pages
//! with a 32-byte trailer (16-byte nonce + 16-byte tag).

use chacha20::cipher::{KeyIvInit, StreamCipher, StreamCipherSeek};
use poly1305::universal_hash::{KeyInit, UniversalHash};
use sha2::Sha256;

pub const PAGE: usize = 4096;
const TRAILER: usize = 32;

pub fn derive_key(passphrase: &[u8], salt: &[u8], iterations: u32) -> [u8; 32] {
    let mut key = [0u8; 32];
    pbkdf2::pbkdf2_hmac::<Sha256>(passphrase, salt, iterations, &mut key);
    key
}

fn chacha20_block(key: &[u8; 32], counter: u32, nonce: &[u8]) -> [u8; 64] {
    let mut out = [0u8; 64];
    let mut cipher = chacha20::ChaCha20::new(key.into(), nonce.into());
    cipher.seek((counter as u64) * 64);
    cipher.apply_keystream(&mut out);
    out
}

fn chacha20_xor(key: &[u8; 32], counter: u32, nonce: &[u8], data: &[u8]) -> Vec<u8> {
    let mut out = data.to_vec();
    let mut cipher = chacha20::ChaCha20::new(key.into(), nonce.into());
    cipher.seek((counter as u64) * 64);
    cipher.apply_keystream(&mut out);
    out
}

fn poly1305_tag(key: &[u8], msg: &[u8]) -> [u8; 16] {
    let mut mac = poly1305::Poly1305::new(key.into());
    mac.update_padded(msg);
    let tag = mac.finalize();
    let mut out = [0u8; 16];
    out.copy_from_slice(&tag);
    out
}

#[derive(Debug)]
pub enum CodecError {
    BadSize,
    BadPage(usize),
}

impl std::fmt::Display for CodecError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CodecError::BadSize => write!(f, "database size is not a multiple of 4096"),
            CodecError::BadPage(n) => write!(f, "authentication failed on page {}", n),
        }
    }
}

pub fn decrypt_db_file(data: &[u8], passphrase: &str, iterations: u32) -> Result<Vec<u8>, CodecError> {
    if data.is_empty() || data.len() % PAGE != 0 {
        return Err(CodecError::BadSize);
    }
    let npages = data.len() / PAGE;
    let salt = &data[0..16];
    let k = derive_key(passphrase.as_bytes(), salt, iterations);
    let mut out = Vec::with_capacity(data.len());
    for pgno in 1..=npages {
        let page = &data[(pgno - 1) * PAGE..pgno * PAGE];
        let nonce = &page[PAGE - TRAILER..PAGE - 16];
        let tag = &page[PAGE - 16..];
        let ctr0 = u32::from_le_bytes([nonce[12], nonce[13], nonce[14], nonce[15]]) ^ (pgno as u32);
        let block = chacha20_block(&k, ctr0, &nonce[0..12]);
        let tagkey = &block[0..32];
        let datakey: [u8; 32] = block[32..64].try_into().unwrap();
        let calc = poly1305_tag(tagkey, &page[0..PAGE - 16]);
        if calc.as_slice() != tag {
            return Err(CodecError::BadPage(pgno));
        }
        let mut pt = chacha20_xor(&datakey, ctr0.wrapping_add(1), &nonce[0..12], &page[0..PAGE - TRAILER]);
        if pgno == 1 {
            pt[0..16].copy_from_slice(b"SQLite format 3\0");
        }
        out.extend_from_slice(&pt);
        out.extend_from_slice(&[0u8; TRAILER]);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chacha20_rfc7539() {
        // RFC 7539 2.3.2 block function vector (counter 1)
        let key: [u8; 32] = core::array::from_fn(|i| i as u8);
        let nonce = [0u8, 0, 0, 9, 0, 0, 0, 0x4a, 0, 0, 0, 0];
        let blk = chacha20_block(&key, 1, &nonce);
        assert_eq!(blk[0..8], [0x10, 0xf1, 0xe7, 0xe4, 0xd1, 0x3b, 0x59, 0x15]);
    }
}
