import { describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";

describe("loadConfig", () => {
  it("mengembalikan alamat kontrak testnet terverifikasi sebagai satu sumber kebenaran", () => {
    const config = loadConfig({});

    expect(config.chainId).toBe(97);
    expect(config.contracts.priceOracle).toBe(
      "0xB5f72a0ab0bA971c8C4F69D4A075cB7fd7859e65",
    );
    expect(config.contracts.registry).toBe(
      "0xb2f36070E6eae3353E8e755172B477DF213ae248",
    );
    expect(config.contracts.subscription).toBe(
      "0xfdb083371f44Cf53181350389D3217e51B431776",
    );
    expect(config.contracts.reputation).toBe(
      "0x279B31B00F64C0ce85BCe2Bd7e377CdcAE58d400",
    );
  });

  it("memakai RPC override wajib, bukan default SDK yang diblokir dari Indonesia", () => {
    const config = loadConfig({});

    expect(config.rpcUrl).toBe(
      "https://data-seed-prebsc-1-s1.bnbchain.org:8545",
    );
  });

  it("mengizinkan override RPC_URL lewat env", () => {
    const config = loadConfig({ RPC_URL: "https://custom-rpc.example/97" });

    expect(config.rpcUrl).toBe("https://custom-rpc.example/97");
  });

  it("bekerja tanpa SCAN8004_API_KEY (tier anonim)", () => {
    const config = loadConfig({});

    expect(config.scan8004.apiKey).toBeUndefined();
    expect(config.scan8004.baseUrl).toBe("https://api.8004scan.io/api/v1");
  });

  it("mengisi API key dari env bila tersedia, tanpa membocorkannya ke default lain", () => {
    const config = loadConfig({ SCAN8004_API_KEY: "rahasia-123" });

    expect(config.scan8004.apiKey).toBe("rahasia-123");
  });

  it("tidak pernah menaruh API key di representasi string/JSON config", () => {
    const config = loadConfig({ SCAN8004_API_KEY: "rahasia-123" });

    expect(JSON.stringify(config)).not.toContain("rahasia-123");
  });
});
