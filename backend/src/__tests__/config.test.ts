import { describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";

describe("loadConfig", () => {
  it("returns the verified testnet contract addresses as one source of truth", () => {
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

  it("uses the mandatory RPC override, not the SDK default that is blocked from Indonesia", () => {
    const config = loadConfig({});

    expect(config.rpcUrl).toBe(
      "https://data-seed-prebsc-1-s1.bnbchain.org:8545",
    );
  });

  it("allows RPC_URL to be overridden through the environment", () => {
    const config = loadConfig({ RPC_URL: "https://custom-rpc.example/97" });

    expect(config.rpcUrl).toBe("https://custom-rpc.example/97");
  });

  it("works without SCAN8004_API_KEY (the anonymous tier)", () => {
    const config = loadConfig({});

    expect(config.scan8004.apiKey).toBeUndefined();
    expect(config.scan8004.baseUrl).toBe("https://api.8004scan.io/api/v1");
  });

  it("fills the API key from the environment when present, without leaking it into other defaults", () => {
    const config = loadConfig({ SCAN8004_API_KEY: "secret-123" });

    expect(config.scan8004.apiKey).toBe("secret-123");
  });

  it("never puts the API key into the config's string/JSON representation", () => {
    const config = loadConfig({ SCAN8004_API_KEY: "secret-123" });

    expect(JSON.stringify(config)).not.toContain("secret-123");
  });
});
