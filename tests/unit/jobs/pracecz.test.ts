import { describe, it, expect } from "vitest";
import * as cheerio from "cheerio";
import { cardListings } from "@/lib/jobs/sources/pracecz";

const LISTING_PAGE = `<div class="StackItem">
  <a class="link-primary" data-testid="advert-link" href="/nabidka/9b2d489c-1706-4146-a094-f34d0e982871/?rps=2077">Seniorní vývojář TypeScript / Technický vedoucí týmu</a>
  <ul>
    <li><span class="accessibility-hidden">Lokalita :</span> <span>Brno</span></li>
    <li><span class="accessibility-hidden">Název firmy :</span> <span>PŘEDVÝBĚR.CZ a.s.</span></li>
    <li><span class="accessibility-hidden">Typ úvazku :</span> <span>Plný úvazek</span></li>
    <li><span>Plat : 100 000 – 140 000 Kč/měsíc</span></li>
    <li>Méně než týden</li>
  </ul>
</div>
<div class="StackItem">
  <a data-testid="advert-link" href="/firma/esgbmx-avenga/nabidka/3e18314e-8616-412a-81dc-5b42c8496daf/?rps=2077">Full-Stack Engineer (Java&amp;React)</a>
  <ul><li><span class="accessibility-hidden">Lokalita :</span> <span>Praha</span></li></ul>
</div>
<div class="StackItem">
  <a data-testid="advert-link" href="/nabidka/9b2d489c-1706-4146-a094-f34d0e982871/?rps=2077">duplicate</a>
</div>`;

describe("prace.cz cardListings", () => {
  it("reads title, city, company, employment type and salary off each card and drops duplicates", () => {
    const listings = cardListings(cheerio.load(LISTING_PAGE));
    expect(listings).toHaveLength(2);
    expect(listings[0]).toMatchObject({
      url: "https://www.prace.cz/nabidka/9b2d489c-1706-4146-a094-f34d0e982871/?rps=2077",
      title: "Seniorní vývojář TypeScript / Technický vedoucí týmu",
      location: "Brno",
      company: "PŘEDVÝBĚR.CZ a.s.",
      workType: "Plný úvazek",
      salary: "100 000 – 140 000 Kč/měsíc",
    });
    expect(listings[1]).toMatchObject({ title: "Full-Stack Engineer (Java&React)", location: "Praha" });
  });
});
