import { z } from 'zod';
import { jsonSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/json-schema';
import { claudeClient, SUGGEST_MODEL } from '../lib/claude.js';
import { verifyRewording } from './verify.js';
import type { Objection } from './verify.js';

/**
 * AI-proposed rewordings of bullets the candidate wrote.
 *
 * The competitor this answers to rewrites and invents bullets to insert the
 * keywords a posting asks for. CLAUDE.md rule 1 forbids that, so this is the
 * honest form of the same feature, and the difference is exactly two things:
 *
 *   1. **The model proposes; it never writes.** Nothing here touches the
 *      database. A proposal is a proposal until the candidate accepts it, the
 *      same contract `profile/parse.ts` has — and when they do accept, what
 *      gets stored is their bullet, edited by them. Tailoring still only
 *      selects and orders, `integrity.allVerbatim` is still computed against
 *      the stored profile, and rule 1 is untouched by this whole file.
 *   2. **The model is not trusted.** Every proposal goes through
 *      `verifyRewording` before a human sees it. The instructions below tell
 *      the model not to add facts; the verifier is what makes it true. If a
 *      future model starts embellishing, the proposals get discarded and the
 *      count of discards is reported rather than hidden.
 *
 * A suggestion is therefore never about *what the candidate did* — only about
 * how the sentence reads.
 */

export interface Suggestion {
  bulletId: string;
  original: string;
  proposal: string;
  /** Why it reads better. Advice about writing, never about facts. */
  rationale: string;
}

export interface Discarded {
  bulletId: string;
  original: string;
  /** Kept so the failure is inspectable rather than a silent drop. */
  proposal: string;
  objections: Objection[];
}

export interface SuggestionResult {
  suggestions: Suggestion[];
  /**
   * Proposals the verifier refused. Reported, not hidden: a rising number
   * here is the signal that the model has drifted, and it is the only place
   * that would show.
   */
  discarded: Discarded[];
  model: string | null;
}

export interface BulletInput {
  id: string;
  text: string;
}

/** One model round-trip. Injected so tests run with no key and no network. */
export type Proposer = (bullets: readonly BulletInput[]) => Promise<ProposedRewording[]>;

export interface ProposedRewording {
  id: string;
  rewritten: string;
  why: string;
}

/**
 * The shape the model must answer in.
 *
 * Written as JSON Schema rather than through the SDK's Zod helper because this
 * repo is on Zod 3 and that helper wants Zod 4 — one file quietly importing a
 * second major version of a validator is the kind of thing that type-checks
 * today and breaks a `.strict()` somewhere else next month.
 */
const PROPOSAL_SCHEMA = {
  type: 'object',
  properties: {
    proposals: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'the id of the bullet this rewrites, copied exactly' },
          rewritten: {
            type: 'string',
            description: 'the rewritten line, or the original unchanged if it cannot be '
              + 'improved without adding a fact',
          },
          why: {
            type: 'string',
            description: 'one short sentence on what reads better, about the writing only',
          },
        },
        required: ['id', 'rewritten', 'why'],
        additionalProperties: false,
      },
    },
  },
  required: ['proposals'],
  additionalProperties: false,
} as const;

/**
 * The same shape again, checked at runtime.
 *
 * The parser types `parsed_output`, it does not prove it. Everything below
 * assumes three strings per proposal, and a missing one would reach
 * `verifyRewording` as `undefined`.
 */
const Proposals = z.object({
  proposals: z.array(z.object({
    id: z.string(),
    rewritten: z.string(),
    why: z.string(),
  })),
});

/**
 * What the model is told.
 *
 * Written as prohibitions with reasons rather than a style guide, because the
 * failure mode being prevented is not bad writing — it is a confident,
 * plausible sentence that says something the candidate never said.
 */
const SYSTEM = `You help a job candidate tighten résumé bullet points that they wrote themselves.

Your only job is to make the sentence read better. You may:
- replace weak or vague verbs with precise ones
- cut filler ("was responsible for", "helped to", "worked on")
- put the outcome before the method
- fix grammar, tense and parallel structure

You must never introduce a fact the line does not already contain. Specifically:
- no numbers, percentages, durations, team sizes or money that are not already there
- no tools, technologies, languages, platforms, companies or product names that are not already there
- no claim of leading, owning, founding, architecting or managing unless the line already says so
- no superlatives ("first", "best", "seamless", "flawless")

You must also not remove a fact. If the line contains a number or a tool name, the rewrite keeps it.

This matters because the result goes on a CV under the candidate's name and is read in a hiring process. A sentence that sounds better but says something they did not do is worse than a clumsy sentence that is true.

If a line is already good, or cannot be improved without adding something, return it unchanged and say so in one short sentence.`;

function userMessage(bullets: readonly BulletInput[]): string {
  const lines = bullets.map((b) => `[${b.id}] ${b.text}`).join('\n');
  return `Rewrite each of these lines. Return one proposal per line, keeping the id exactly as given.\n\n${lines}`;
}

/** The real proposer: one Claude call for the whole batch. */
export const claudeProposer: Proposer = async (bullets) => {
  const client = claudeClient();
  if (!client) return [];

  const response = await client.messages.parse({
    model: SUGGEST_MODEL,
    max_tokens: 16000,
    system: SYSTEM,
    thinking: { type: 'adaptive' },
    output_config: { format: jsonSchemaOutputFormat(PROPOSAL_SCHEMA) },
    messages: [{ role: 'user', content: userMessage(bullets) }],
  });

  // A refusal is a stop reason, not an exception, and `parsed_output` is null
  // when the response did not parse. Both mean no proposals, not a crash.
  if (response.stop_reason === 'refusal') return [];
  const checked = Proposals.safeParse(response.parsed_output);
  return checked.success ? checked.data.proposals : [];
};

/**
 * Propose rewordings for a set of bullets, and discard anything that claims.
 *
 * Pure with respect to the database: it reads nothing and writes nothing. The
 * caller loads the bullets and the caller stores an accepted one.
 */
export async function suggestRewordings(
  bullets: readonly BulletInput[],
  propose: Proposer = claudeProposer,
): Promise<SuggestionResult> {
  if (bullets.length === 0) {
    return { suggestions: [], discarded: [], model: SUGGEST_MODEL };
  }

  const byId = new Map(bullets.map((b) => [b.id, b.text]));
  const proposed = await propose(bullets);

  const suggestions: Suggestion[] = [];
  const discarded: Discarded[] = [];
  const seen = new Set<string>();

  for (const p of proposed) {
    const original = byId.get(p.id);
    // An id we did not send is not a bullet of this candidate's. Dropped
    // without comment rather than matched by position: position matching is
    // how a rewrite ends up attached to the wrong job.
    if (original === undefined) continue;
    if (seen.has(p.id)) continue;
    seen.add(p.id);

    const verdict = verifyRewording(original, p.rewritten);
    if (verdict.ok) {
      suggestions.push({
        bulletId: p.id,
        original,
        proposal: p.rewritten.trim(),
        rationale: p.why.trim(),
      });
    } else if (!verdict.objections.some((o) => o.kind === 'unchanged' || o.kind === 'empty')) {
      // "Unchanged" is the model correctly declining, not a failure worth
      // reporting as one. Everything else is a claim it tried to make.
      discarded.push({
        bulletId: p.id,
        original,
        proposal: p.rewritten.trim(),
        objections: verdict.objections,
      });
    }
  }

  return { suggestions, discarded, model: SUGGEST_MODEL };
}
