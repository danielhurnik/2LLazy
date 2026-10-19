import { runGenericFlow } from "../formFiller";
import type { ApplyAdapter } from "../types";

const ENTRY = /^(reply|reagovat( na nab[ií]dku)?|odpov[eě]d[eě]t( na inzer[aá]t)?|respond)$/i;
const SUBMIT = /^(send|odeslat|odeslat (odpov[eě][dď]|formul[aá][rř]|reakci)|submit)$/i;

export const jobsczAdapter: ApplyAdapter = {
  id: "jobscz",
  matches: (url) => /(^|\.)(jobs\.cz|teamio\.com|prace\.cz)$/i.test(url.hostname),
  run: (ctx) => runGenericFlow(ctx, { entry: ENTRY, submit: SUBMIT }),
};
