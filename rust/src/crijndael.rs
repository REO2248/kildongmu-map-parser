//! Proprietary CRijndael variant used by libshdatakeyservice.so.
//!
//! Byte-compatible with the native implementation: 32-byte blocks, 256-bit keys,
//! ECB only, mutated key-schedule bit packing and a 16-byte final-round mask.

const SBOX: [u8; 256] = [
    0x63, 0x7c, 0x77, 0x7b, 0xf2, 0x6b, 0x6f, 0xc5, 0x30, 0x01, 0x67, 0x2b, 0xfe, 0xd7, 0xab, 0x76,
    0xca, 0x82, 0xc9, 0x7d, 0xfa, 0x59, 0x47, 0xf0, 0xad, 0xd4, 0xa2, 0xaf, 0x9c, 0xa4, 0x72, 0xc0,
    0xb7, 0xfd, 0x93, 0x26, 0x36, 0x3f, 0xf7, 0xcc, 0x34, 0xa5, 0xe5, 0xf1, 0x71, 0xd8, 0x31, 0x15,
    0x04, 0xc7, 0x23, 0xc3, 0x18, 0x96, 0x05, 0x9a, 0x07, 0x12, 0x80, 0xe2, 0xeb, 0x27, 0xb2, 0x75,
    0x09, 0x83, 0x2c, 0x1a, 0x1b, 0x6e, 0x5a, 0xa0, 0x52, 0x3b, 0xd6, 0xb3, 0x29, 0xe3, 0x2f, 0x84,
    0x53, 0xd1, 0x00, 0xed, 0x20, 0xfc, 0xb1, 0x5b, 0x6a, 0xcb, 0xbe, 0x39, 0x4a, 0x4c, 0x58, 0xcf,
    0xd0, 0xef, 0xaa, 0xfb, 0x43, 0x4d, 0x33, 0x85, 0x45, 0xf9, 0x02, 0x7f, 0x50, 0x3c, 0x9f, 0xa8,
    0x51, 0xa3, 0x40, 0x8f, 0x92, 0x9d, 0x38, 0xf5, 0xbc, 0xb6, 0xda, 0x21, 0x10, 0xff, 0xf3, 0xd2,
    0xcd, 0x0c, 0x13, 0xec, 0x5f, 0x97, 0x44, 0x17, 0xc4, 0xa7, 0x7e, 0x3d, 0x64, 0x5d, 0x19, 0x73,
    0x60, 0x81, 0x4f, 0xdc, 0x22, 0x2a, 0x90, 0x88, 0x46, 0xee, 0xb8, 0x14, 0xde, 0x5e, 0x0b, 0xdb,
    0xe0, 0x32, 0x3a, 0x0a, 0x49, 0x06, 0x24, 0x5c, 0xc2, 0xd3, 0xac, 0x62, 0x91, 0x95, 0xe4, 0x79,
    0xe7, 0xc8, 0x37, 0x6d, 0x8d, 0xd5, 0x4e, 0xa9, 0x6c, 0x56, 0xf4, 0xea, 0x65, 0x7a, 0xae, 0x08,
    0xba, 0x78, 0x25, 0x2e, 0x1c, 0xa6, 0xb4, 0xc6, 0xe8, 0xdd, 0x74, 0x1f, 0x4b, 0xbd, 0x8b, 0x8a,
    0x70, 0x3e, 0xb5, 0x66, 0x48, 0x03, 0xf6, 0x0e, 0x61, 0x35, 0x57, 0xb9, 0x86, 0xc1, 0x1d, 0x9e,
    0xe1, 0xf8, 0x98, 0x11, 0x69, 0xd9, 0x8e, 0x94, 0x9b, 0x1e, 0x87, 0xe9, 0xce, 0x55, 0x28, 0xdf,
    0x8c, 0xa1, 0x89, 0x0d, 0xbf, 0xe6, 0x42, 0x68, 0x41, 0x99, 0x2d, 0x0f, 0xb0, 0x54, 0xbb, 0x16,
];

const T16: [u8; 16] = [
    0x7c, 0x64, 0xe7, 0x4a, 0x0e, 0xd6, 0x75, 0x21, 0x63, 0xc6, 0x97, 0x35, 0x6a, 0xd4, 0x6f, 0x36,
];

const RCON: [u8; 16] = [
    0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36, 0x6c, 0xd8, 0xab, 0x4d, 0x9a, 0x2f,
];

const NB: usize = 8;
const NR: usize = 14;
const NK: usize = 8;
const TOTAL: usize = NB * (NR + 1);

const fn xt(a: u8) -> u8 {
    let x = (a as u32) << 1;
    if x & 0x100 != 0 {
        (x ^ 0x11b) as u8
    } else {
        x as u8
    }
}

const fn build_te() -> [[u32; 256]; 4] {
    let mut t = [[0u32; 256]; 4];
    let mut i = 0;
    while i < 256 {
        let s = SBOX[i];
        let s2 = xt(s);
        let s3 = s2 ^ s;
        let w = ((s2 as u32) << 24) | ((s as u32) << 16) | ((s as u32) << 8) | (s3 as u32);
        t[0][i] = w;
        t[1][i] = w.rotate_right(8);
        t[2][i] = w.rotate_right(16);
        t[3][i] = w.rotate_right(24);
        i += 1;
    }
    t
}

static TE: [[u32; 256]; 4] = build_te();

pub struct Rijndael {
    rk: [u32; TOTAL],
}

impl Rijndael {
    pub fn new(key: &[u8]) -> Self {
        assert!(key.len() >= 32, "key must be at least 32 bytes");
        let mut temp = [0u32; NK];
        for i in 0..NK {
            let b = &key[4 * i..4 * i + 4];
            temp[i] = ((b[0] as u32) << 20)
                | ((b[1] as u32) << 11)
                | ((b[2] as u32) << 4)
                | (b[3] as u32);
        }
        let mut rk = [0u32; TOTAL];
        for i in 0..NK {
            rk[(i / NB) * NB + i % NB] = temp[i];
        }
        let mut i = NK;
        let mut rc = 0usize;
        while i < TOTAL {
            let t0 = temp[NK - 1];
            let mut t = (((SBOX[(t0 & 0xff) as usize] as u32) << 8)
                | (SBOX[((t0 >> 19) & 0xff) as usize] as u32))
                ^ temp[0];
            t ^= (SBOX[((t0 >> 11) & 0xff) as usize] as u32) << 13;
            t ^= (SBOX[((t0 >> 6) & 0xff) as usize] as u32) << 17;
            t ^= (RCON[rc] as u32) << 22;
            rc += 1;
            temp[0] = t;
            t ^= temp[1];
            temp[1] = t;
            t ^= temp[2];
            temp[2] = t;
            t ^= temp[3];
            temp[3] = t;
            let mut t2 = temp[4]
                ^ (SBOX[(t & 0xff) as usize] as u32)
                ^ ((SBOX[((t >> 22) & 0xff) as usize] as u32) << 24)
                ^ ((SBOX[((t >> 15) & 0xff) as usize] as u32) << 15)
                ^ ((SBOX[((t >> 8) & 0xff) as usize] as u32) << 7);
            temp[4] = t2;
            t2 ^= temp[5];
            temp[5] = t2;
            t2 ^= temp[6];
            temp[6] = t2;
            temp[7] ^= t2;
            for k in 0..NK {
                let idx = i + k;
                if idx >= TOTAL {
                    break;
                }
                rk[(idx / NB) * NB + idx % NB] = temp[k];
            }
            i += NK;
        }
        Self { rk }
    }

    pub fn encrypt_block(&self, inp: &[u8], out: &mut [u8]) {
        let mut st = [0u32; NB];
        for j in 0..NB {
            st[j] = ((inp[4 * j] as u32) << 24)
                | ((inp[4 * j + 1] as u32) << 16)
                | ((inp[4 * j + 2] as u32) << 8)
                | (inp[4 * j + 3] as u32);
            st[j] ^= self.rk[j];
        }
        for rnd in 1..NR {
            let mut ns = [0u32; NB];
            for j in 0..NB {
                let w0 = st[j];
                let w1 = st[(j + 1) % NB];
                let w2 = st[(j + 3) % NB];
                let w3 = st[(j + 4) % NB];
                ns[j] = TE[0][(w0 >> 24) as usize]
                    ^ TE[1][((w1 >> 16) & 0xff) as usize]
                    ^ TE[2][((w2 >> 8) & 0xff) as usize]
                    ^ TE[3][(w3 & 0xff) as usize]
                    ^ self.rk[rnd * NB + j];
            }
            st = ns;
        }
        for j in 0..NB {
            let w0 = st[j];
            let w1 = st[(j + 1) % NB];
            let w2 = st[(j + 3) % NB];
            let w3 = st[(j + 4) % NB];
            let k = self.rk[NR * NB + j];
            out[4 * j] = SBOX[(w0 >> 24) as usize] ^ ((k >> 24) as u8) ^ T16[(4 * j + 6) & 15];
            out[4 * j + 1] = SBOX[((w1 >> 16) & 0xff) as usize] ^ ((k >> 16) as u8) ^ T16[(4 * j + 4) & 15];
            out[4 * j + 2] = SBOX[((w2 >> 8) & 0xff) as usize] ^ ((k >> 8) as u8) ^ T16[(4 * j + 11) & 15];
            out[4 * j + 3] = SBOX[(w3 & 0xff) as usize] ^ (k as u8) ^ T16[(4 * j + 5) & 15];
        }
    }

    pub fn encrypt_ecb(&self, data: &[u8]) -> Vec<u8> {
        let blocks = data.len() / 32;
        let mut out = vec![0u8; blocks * 32];
        for b in 0..blocks {
            self.encrypt_block(&data[b * 32..b * 32 + 32], &mut out[b * 32..b * 32 + 32]);
        }
        out
    }
}
