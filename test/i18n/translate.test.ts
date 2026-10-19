import { describe, it } from "mocha";
import { expect } from "chai";
import { isLocale } from "@/lib/i18n/locale";
import { translate } from "@/lib/i18n/translate";

describe("app language", () => {
  it("keeps English copy and falls back when a phrase has no Spanish entry", () => {
    expect(isLocale("en")).to.equal(true);
    expect(isLocale("es")).to.equal(true);
    expect(isLocale("fr")).to.equal(false);
    expect(translate("en", "Dashboard")).to.equal("Dashboard");
    expect(translate("es", "Not a real label")).to.equal("Not a real label");
  });

  it("translates page copy to Spanish and fills placeholders", () => {
    expect(translate("es", "Dashboard")).to.equal("Tablero");
    expect(translate("es", "Sign out")).to.equal("Cerrar sesión");
    expect(translate("es", "  Receiving  ")).to.equal("Recepción");
    expect(
      translate("es", "{{delivered}} of {{total}} pallets checked in", {
        delivered: 2,
        total: 5,
      }),
    ).to.equal("2 de 5 tarimas registradas");
    expect(translate("en", "Pallet {{number}}", { number: "P1" })).to.equal("Pallet P1");
  });
});
