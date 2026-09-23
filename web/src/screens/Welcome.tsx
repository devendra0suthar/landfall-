/**
 * The first thing a new account sees.
 *
 * Accounts made this reachable for the first time. Before them the only
 * candidate was the seeded one, so every screen always had data; the moment
 * someone could sign up, the product's opening move became eight screens of
 * "Nothing here yet" and an API politely explaining that they should run
 * `pnpm seed`.
 *
 * It is a route (`#/welcome`) rather than a modal, so it can be linked, backed
 * out of and returned to. It is shown *instead of* the job list until a profile
 * exists, because a job list with no profile behind it is a list of postings
 * with every match score blank — which looks broken rather than empty.
 *
 * Three ways out, deliberately. The recommended one is first, but "I do not
 * have my CV to hand" and "I only want to look" are both real, and a product
 * that demands an upload before it shows anything gets closed.
 */

export function Welcome({ email }: { email: string }): React.ReactElement {
  return (
    <div className="body">
      <div className="head">
        <div>
          <span className="lbl">Welcome</span>
          <h1>Let’s build your profile</h1>
        </div>
      </div>

      <div className="card flow">
        <p>
          You’re signed in as <span className="mono">{email}</span>. Nothing is stored
          about you yet — this is a blank account, and it stays blank until you put
          something in it.
        </p>
      </div>

      <div className="card flow">
        <span className="lbl">How this works</span>
        <ol className="steps">
          <li>
            <strong>Your résumé becomes structured facts.</strong> We read it into roles,
            dates, bullets and skills — each one with a confidence score, shown to you for
            correction. A parse is a proposal: nothing becomes true until you confirm it.
          </li>
          <li>
            <strong>Those facts answer employers’ forms.</strong> One answer to “Are you
            authorised to work…” unlocks hundreds of postings, because the same questions
            recur across employers. That reuse is the whole point of the answer bank.
          </li>
          <li>
            <strong>You get an Application Kit per job.</strong> Every question the
            employer asks, with your answer prepared and its source shown — plus a
            tailored résumé and a letter draft. You review it and you apply.
          </li>
        </ol>
        <p className="sub">
          Landfall never submits an application and never writes a claim on your behalf.
          Tailoring chooses which of your own sentences to show; it does not write new ones.
        </p>
      </div>

      <div className="card flow">
        <span className="lbl">Start here</span>
        <div className="row split">
          <div>
            <strong>Upload your résumé</strong>
            <div className="sub">PDF, DOCX, RTF or plain text. The fastest route in.</div>
          </div>
          <a className="btn p" href="#/resume">Upload a résumé</a>
        </div>
        <div className="row split">
          <div>
            <strong>Type it in instead</strong>
            <div className="sub">No file to hand? Add your roles and bullets directly.</div>
          </div>
          <a className="btn" href="#/profile">Add by hand</a>
        </div>
        <div className="row split">
          <div>
            <strong>Just look around</strong>
            <div className="sub">
              Browse the index first. Match scores stay blank until there’s a profile to
              compare against.
            </div>
          </div>
          <a className="btn" href="#/jobs">Browse jobs</a>
        </div>
      </div>
    </div>
  );
}
