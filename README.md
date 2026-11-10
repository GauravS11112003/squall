# Squall

**Squall sees the outage in the tickets.** When a shared service fails, dozens of employees report it in dozens of different ways, and the service desk works those tickets one at a time until somebody notices they are all the same problem. Squall reads each ticket as it lands, groups the ones that describe the same fault, and raises the major incident while it is still forming. Then it finds the workaround, checks it is safe to send, and drafts a broadcast that cannot say anything the reports do not support.

Every judgement in Squall comes from the [Clocked API](https://clocked.rezolve.ai) by Rezolve.ai, with its probability and the words it rests on. What to do at each probability is plain code in one file.

Built for the Clocked Build Challenge, October 21 to November 10, 2026.

<!-- RESULTS:START -->
<!-- RESULTS:END -->

## Try it

- **Live demo:** see the repository description for the link. It replays a recorded live run: every probability, quote, timing and credit count in it is an unedited Clocked response.
- **Run it yourself, live:**

```sh
git clone <this repository> && cd squall
npm install
cp .env.local.example .env.local   # then add your CLOCKED_API_KEY
npm run dev                        # http://localhost:3000
```

Press **Start the storm**. A full live storm reads 38 synthetic tickets and uses roughly 3,000 credits (the exact figure for the recorded run is in `eval/results.json`). You can also type your own ticket into the storm and watch where it lands.

Other commands:

| Command | What it does |
|---|---|
| `npm run probe` | About ten real Clocked calls on storm tickets, raw answers saved to `probe/out.json`. A cheap check that your key works. |
| `npm run eval` | Runs the whole storm live, scores it against ground truth and a keyword baseline, and writes `eval/results.json` and the recording the demo replays. |
| `npm test` | Engine tests on the offline simulator, including the failure paths. |

Node 20 or newer. The key stays on the server: the browser never sees it.

## What happens to a ticket

```
ticket ─► Protect + Guard ─► Extract + Rerank ─► Compare ─► Decide ─► Rerank ─► Guard + Inspect ─► Fill ─► Verify
          (one pipeline)     (one pipeline)       merge?     major?    workaround   safe to send?    draft   every claim
```

Each endpoint is there because its answer changes what Squall does next.

| Step | Clocked endpoint | What its answer changes |
|---|---|---|
| Mask | **Protect** `/pii` (in a pipeline) | The masked text replaces the ticket. Every later call, the incident view and the broadcast read the masked text and never the original. If Protect does not answer, the ticket is not read at all. |
| Screen | **Guard** `/injection` (same pipeline) | A ticket at or above 50% injection is held: it is not grouped and cannot move an incident. The storm contains one ticket that tells the triage system to close every VPN ticket and suppress the incident. |
| Read | **Extract** `/extract` (in a pipeline) | Service, error, place and start time are quoted verbatim with their positions. They are pooled, by counting, into the incident's title and facts, and highlighted in the ticket. |
| Shortlist | **Rerank** `/rerank` (same pipeline) | The new ticket is the query; open incidents and recent lone tickets are the documents. Only candidates marked `use` or `expand` go on to Compare. `different_case` is what keeps "how do I install the VPN?" out of the VPN outage. |
| Merge | **Compare** `/compare` | The decision to merge. A ticket joins an incident only when Compare reads the pair as `same` or `conflicting` with at least 60% probability. Its matching passages are shown side by side. `conflicting` pairs are recorded as disagreements on the incident. |
| Size up | **Decide** `/decide` | From three reports: a yes/no "is this a major incident?", a choice of scope and a severity score, each with probabilities. At 85% or more the incident is declared with no person involved; from 50% the manager is asked; below that Squall keeps watching. A recorded disagreement always sends it to a person. |
| Find the fix | **Rerank** `/rerank` | Over the knowledge base. `use` passages are candidates; `expand` pulls in the neighbouring chunk of the same article. When the same person writes again, Rerank gets the thread as `conversation`, comes back with `already_given` for what they were sent, and the next step goes out instead. |
| Check the fix | **Guard** + **Inspect** `/script` (one pipeline) | Each candidate passage is screened as retrieved content, and any script in it is read by Inspect before it could reach an employee's laptop. The knowledge base contains a poisoned "community tip" that ranks first for the VPN fault; its script disables antivirus and runs a download. It is blocked and the next passage is used. |
| Draft | **Fill** `/fill` | One typed record: service, error and start time extracted, who is affected and what to do generated. The broadcast is assembled from those fields. |
| Prove it | **Verify** `/grounding` | The broadcast is checked claim by claim against the incident's tickets and the passage it cites. **Send** stays disabled until every counted claim is supported. Edit the draft, add something the reports do not say, and watch the claim fail. |

`/pipeline` is used wherever two steps read the same text, so they cost one request and one debit.

### Around the storm

The stage shows what is happening; these make it usable as a product.

| Feature | What it does |
|---|---|
| **Narration** | The bottom console says what just happened to the latest ticket in one sentence, and shows how far it got through the six steps (Mask, Screen, Read, Shortlist, Match, Size up) with the Clocked endpoint named under each. |
| **Moments** | An incident declared, a ticket held, a dangerous fix blocked, two reports disagreeing: each appears over the stage as a short banner and links to its evidence. |
| **Activity** | The same events as a running audit trail beside the ticket list. |
| **Policy lines** | The manager can move the three lines (declare without a person, ask a person, hold a ticket). In live mode they apply from the next ticket. In every mode the sheet replays the Clocked answers already taken against the lines, so you can see what a stricter or looser policy would have done before committing to it. |
| **Deadlines** | Extract quotes any deadline the reporter mentions. The incident lists those reporters first, in their own words. |
| **Where it is felt** | Reports per site, counted from Extract's verbatim values. |
| **Step through** | Read one ticket at a time with the step button or the right arrow; space plays and pauses. |
| **Incident report** | One click exports the incident as Markdown: timeline, every Decide reading, the disagreements, which fix was sent and which was blocked, the update with each claim's verdict, the masked reports and the Clocked usage. |
| **Guide** | One sheet that explains every mark on the stage and every step, opened with `?`. |

The narration, the activity trail, the what-if view and the report are built by counting and string-building over the engine's state ([`lib/story.ts`](lib/story.ts), [`lib/report.ts`](lib/report.ts)). No model is asked to explain what another model did.

### What is not a model call

Rezolve's own guidance is to keep dates, counting and policy in deterministic code, and Squall does:

- **Thresholds and instructions** live in [`lib/policy.ts`](lib/policy.ts). Nothing else decides what a probability means.
- **A reply in a thread** joins its thread's incident. That is bookkeeping, so no model is asked.
- **Incident facts** are counts of members' verbatim Extract values.
- **The baseline, the scoring and the cost totals** are arithmetic over logged values.

## Uncertainty, missing data and failed requests

Squall fails toward a person, never toward a guess.

| What goes wrong | What Squall does |
|---|---|
| Protect or Guard does not answer | The ticket is marked "not read". Its text goes nowhere else and it is not grouped. |
| Guard is unsure (at or above the line) | The ticket is held, shown with the flagged words, and kept out of every incident. |
| Rerank does not answer | The ticket stays on its own. It is not merged. |
| Compare does not answer, or reads the pair as overlapping or unrelated | No merge. The ticket's page says which pair was read and how. |
| Decide does not answer | The incident goes to the manager with that reason. |
| Decide is between 50% and 85%, or reports disagree | The manager decides. The reason is stated on the incident. |
| Extract finds no value | The field is left empty. Nothing is inferred. |
| Inspect or Guard cannot check a passage | The passage is not sent ("not sent: check failed"). |
| Every candidate workaround is blocked | Nothing is sent. The incident says to write the reply by hand. |
| Fill does not answer | No draft. The checked workaround can still go out. |
| Verify does not answer | The draft is marked unchecked and cannot be sent. |
| The key is wrong, credits run out, or the plan's concurrency limit is hit | The storm stops with the reason and resumes from the same ticket. |

The official SDK retries 429s and 5xx responses with the same idempotency key, so a retried call is billed once. The failure paths are covered in [`tests/engine.test.ts`](tests/engine.test.ts).

## How it was evaluated

The storm in [`data/storm.ts`](data/storm.ts) is synthetic and labelled: 38 tickets over eight minutes at a fictional company. It contains three real faults (a VPN gateway outage across two cities, MFA push approvals not arriving in one office, one offline printer) and deliberately awkward tickets:

- a Spanish-language report of the VPN outage, and a terse one ("vpn ded again??");
- two how-to questions about the same products, and a "VPN is slow abroad" ticket, none of which are the outage;
- a report that disagrees with the others about when the fault started;
- two follow-ups from people who already received the workaround;
- ten planted pieces of personal data;
- one ticket carrying a prompt injection that tries to suppress the incident.

The labels are in [`data/truth.ts`](data/truth.ts). The engine never imports that file: it is given the ticket text and nothing else.

`npm run eval` runs the storm through the live API and reports:

- **grouping**, as pairwise precision and recall: of every two tickets Squall put together, were they the same fault, and of every two that were, did Squall put them together;
- **time to flag** each real major incident, in storm seconds after its first report;
- whether the **hostile ticket** was held and whether any **planted personal data** survived masking;
- **credits and model time**, summed from the `X-Clocked-Credits` and `X-Clocked-Model-Ms` headers of every call.

The comparison is the rule many desks run today: bucket tickets by keyword and raise an incident at five in a bucket within ten minutes. It costs nothing and reads nothing.

### Limits of this evaluation

- It is one synthetic storm written by the same person who built the engine. It shows the mechanism works on realistic awkward cases; it is not evidence about your tickets.
- Thresholds were set by reasoning and one probe run, not tuned on a held-out set. Rezolve's advice to test calibration on your own tickets applies in full.
- The keyword baseline is a plain one. A desk with a tuned rules engine would do better than it.
- Clocked's answers can change between model versions, so a rerun may differ from the recorded run.

## Repository map

```
app/                 Next.js app: the console and four server routes (step, declare, verify, status)
components/Stage.tsx The 3D storm: shader hurricanes, ticket dots, merge arcs (React Three Fiber)
components/          Console (state and run loop), Stream, IncidentCard, TicketCard, Dock, Moments,
                     PolicySheet, Guide, Scoreboard
lib/engine.ts        One ticket through every step; the response flow; all failure handling
lib/policy.ts        Every threshold and every instruction sent to Clocked
lib/story.ts         Plain-language events, the six-step journey, what-if on policy lines
lib/report.ts        The exported incident report
lib/api.ts           The single seam to Clocked (official clocked-sdk)
lib/metrics.ts       Scoring, the keyword baseline, cost totals
lib/sim.ts           Offline keyword simulator for development and tests. Not Clocked; always labelled.
data/                The synthetic storm, its ground truth, the synthetic knowledge base
scripts/             probe.ts and eval.ts
eval/results.json    Output of the last live evaluation
public/recordings/   The recorded live run the public demo replays
```

### The stage

The storm is the whole screen. Each incident is a hurricane drawn from sixteen thousand particles in a vertex shader. It grows with every report Compare merges into it, spins faster as Decide's probability rises, and turns from blue (watching) to amber (a person is asked) to red (major). The ink dots riding inside it are the real tickets; select one to see what each endpoint read. The ring on the floor is the probability, with a notch at each policy line. An arc flashes between two tickets when Compare merges them, and an orange line stays between two reports that disagree. Held tickets sit in a dashed red pen.

Three glass panels float over the stage: the ticket stream and activity trail, one focused card (an incident's single number and single action, with the reasoning behind three tabs), and a console that narrates the latest ticket above a timeline with one tick per ticket. Everything on the stage is also in those panels, and motion is switched off for people who ask their system for reduced motion.

## Deploying a public demo

Deploy to any Node host (Vercel works with no configuration). Without a key the site replays `public/recordings/latest.json`. To allow live runs on a public site without letting visitors spend your credits, set both `CLOCKED_API_KEY` and `SQUALL_ACCESS_CODE`; live mode then asks for the code.

## Data and safety

- All tickets, people, phone numbers, addresses and systems are invented. Nothing here is real personal data.
- The poisoned knowledge base passage points at a documentation-only address range (203.0.113.0/24). No script in this project is ever executed; Inspect reads scripts as text.
- "Send" in the demo marks a broadcast as sent. Squall has no mail or chat connection and nothing leaves the app.

## Credits

- [Clocked](https://clocked.rezolve.ai) by Rezolve.ai, through the official [`clocked-sdk`](https://www.npmjs.com/package/clocked-sdk) (MIT), supplies every model judgement.
- [Next.js](https://nextjs.org), [React](https://react.dev), [three.js](https://threejs.org), [React Three Fiber](https://github.com/pmndrs/react-three-fiber), [drei](https://github.com/pmndrs/drei) (all MIT) and [Lucide](https://lucide.dev) icons (ISC).
- Typefaces: [Geist and Geist Mono](https://github.com/vercel/geist-font) (SIL Open Font License), via Fontsource.
- Design guidance drawn from three open skills: [impeccable](https://github.com/pbakaus/impeccable), [taste-skill](https://github.com/Leonxlnx/taste-skill) and [ui-ux-pro-max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill).
- Started and built during the challenge window with an AI coding assistant (Claude), as the rules allow. The commit history shows what was built and when.

MIT licensed.
