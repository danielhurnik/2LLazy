import { runGenericFlow } from "../formFiller";
import type { ApplyAdapter } from "../types";

const ENTRY = /m[aá]m z[aá]jem o nab[ií]dku|m[aá]m z[aá]jem/i;
const SUBMIT = /^odeslat z[aá]jem$/i;
const UPLOAD = /uploadnout p[rř][ií]lohu|p[rř][ií]lohu/i;

export const startupjobsAdapter: ApplyAdapter = {
  id: "startupjobs",
  matches: (url) => /(^|\.)startupjobs\.cz$/i.test(url.hostname),
  run: (ctx) => runGenericFlow(ctx, { entry: ENTRY, submit: SUBMIT, upload: UPLOAD }),
};
