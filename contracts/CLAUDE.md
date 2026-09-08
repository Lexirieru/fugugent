# contracts — Fugugent

Foundry. Solidity `^0.8.30`, OpenZeppelin 5.7.0 (submodule di `lib/`). BSC testnet (97).

## Empat kontrak

| Kontrak | Tanggung jawab |
|---|---|
| `FuguPriceOracle` | USD(8 desimal) → jumlah token, via Chainlink atau harga tetap. Tidak menyentuh dana. |
| `FuguRegistry` | Katalog listing agent per kategori. Tidak menyentuh dana. |
| `FuguSubscription` | **Satu-satunya yang memegang dana.** Escrow, klaim pro-rata, refund, revenue share. |
| `FuguReputation` | Review ber-gate bukti langganan. Tidak menyentuh dana. |

## Aturan

- **Jangan tulis `__gap`.** OZ 5.x memakai ERC-7201 namespaced storage sehingga parent
  tidak menggeser slot turunan. Yang berlaku: **append-only** — variabel baru hanya di
  akhir, tidak pernah disisipkan atau dihapus. Dijaga oleh `test/Upgrade.t.sol`.
- Semua kontrak: `Initializable` + `UUPSUpgradeable` + `OwnableUpgradeable`, dengan
  `_disableInitializers()` di constructor dan `_authorizeUpgrade` ber-`onlyOwner`.
- Harga USD selalu 8 desimal, variabel berakhiran `Usd8`.
- **Ambang staleness per token, bukan seragam.** Terverifikasi di testnet: BNB/USD update
  jauh lebih sering daripada USDT/USD (selisih ~8 jam). Ambang seragam akan menolak
  semua pembayaran USDT.
- **USDT di BSC 18 desimal.** Jangan hardcode 6.
- Custom errors, bukan `require` string.
- Native coin = `address(0)`.

## Alamat terverifikasi live (BSC testnet 97, 2026-09-08)

```
Chainlink BNB/USD   0x2514895c72f50D8bd4B4F9b1110F0D6bD2c97526   (8 desimal)
Chainlink USDT/USD  0xEca2605f0BCF2BA5966372C99837b1F182d3D620
Chainlink BUSD/USD  0x9331b55D9830EF609A2aBCfAc0FBCE050A52fdEa
USDT  0x337610d27c682E347C9cD60BD4b3b107C9d34dDd   (18 desimal)
BUSD  0xeD24FC36d5Ee211Ea25A80239Fb8C4Cfd80f12Ee
U     0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565   (tanpa feed → FIXED_USD $1)
WBNB  0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd
```

**Salah, jangan dipakai:** Aave PoolAddressesProvider `0xA97684ea...` tidak punya kode di BSC.

## Perintah

```bash
forge build
forge test                                  # seluruh suite
forge test --match-contract FuguSubscriptionTest -vv
source .env && forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$BSC_TESTNET_RPC_URL" --broadcast --verify
```

`.env` berisi `PRIVATE_KEY` — gitignored, jangan dibaca, jangan di-commit.
