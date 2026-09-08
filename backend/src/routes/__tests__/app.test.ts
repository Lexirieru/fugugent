/**
 * Perilaku tingkat aplikasi: jalur galat yang berada **di luar** `try/catch`
 * tiap handler.
 *
 * `app.onError` adalah satu-satunya jalur yang pesannya tidak pernah melewati
 * penyuntingan mana pun sebelum sampai ke klien — dan justru karena itu ia
 * yang paling mungkin membocorkan kredensial. Test di bawah gagal begitu
 * `redact` di `app.ts` dicabut.
 */
import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { fakeService } from "./fixtures.js";

const SECRET = "sk-RAHASIA-123";

describe("app.onError", () => {
  function appThatThrows(message: string) {
    const app = createApp({ service: fakeService() });
    // Rute sintetis: mewakili galat yang lolos dari luar `try/catch` handler
    // (middleware, atau serialisasi respons), yang hanya `onError` menangkapnya.
    app.get("/api/boom", () => {
      throw new Error(message);
    });
    return app;
  }

  it("menyunting kredensial dari pesan galat yang tidak tertangkap", async () => {
    const app = appThatThrows(
      `GET https://api.8004scan.io/api/v1/agents?api_key=${SECRET} gagal`,
    );
    const res = await app.request("http://api.test/api/boom");

    expect(res.status).toBe(500);
    const raw = await res.text();
    expect(raw).not.toContain(SECRET);
    expect(raw).toContain("[redacted]");
    expect(JSON.parse(raw).error).toBe("internal_error");
  });

  it("menyunting header Authorization dari pesan galat yang tidak tertangkap", async () => {
    const app = appThatThrows(`upstream menolak: Bearer ${SECRET}`);
    const raw = await (await app.request("http://api.test/api/boom")).text();

    expect(raw).not.toContain(SECRET);
    expect(raw).toContain("[redacted]");
  });

  it("tetap JSON, bukan HTML", async () => {
    const app = appThatThrows("kegagalan biasa");
    const res = await app.request("http://api.test/api/boom");

    expect(res.headers.get("content-type")).toContain("application/json");
    const body = JSON.parse(await res.text()) as { message: string };
    expect(body.message).toContain("kegagalan biasa");
  });
});
