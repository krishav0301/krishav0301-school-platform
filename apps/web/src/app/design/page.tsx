import { Badge, Button, Card, Field, Notice, Skeleton, Spinner, Table } from "@/ui";

import styles from "./design.module.css";

const COLOURS = [
  ["background", "--color-background"],
  ["surface", "--color-surface"],
  ["text", "--color-text"],
  ["text muted", "--color-text-muted"],
  ["border", "--color-border"],
  ["primary", "--color-primary"],
  ["primary text", "--color-primary-text"],
  ["ok", "--color-ok"],
  ["ok soft", "--color-ok-soft"],
  ["bad", "--color-bad"],
  ["bad soft", "--color-bad-soft"],
] as const;

/**
 * Every component in one place, drawn with the active school's theme. An internal page for
 * checking the look of a theme (and for the theme-swap tests); English only, no data.
 */
export default function DesignGallery() {
  return (
    <main className={styles.page}>
      <h1 className={styles.h1}>Component gallery</h1>
      <p className={styles.lead}>Everything below is drawn with the current school&apos;s theme.</p>

      <Card aria-labelledby="g-colours">
        <h2 id="g-colours">Colours</h2>
        <ul className={styles.swatches}>
          {COLOURS.map(([name, variable]) => (
            <li key={variable} className={styles.swatch}>
              <span className={styles.chip} style={{ background: `var(${variable})` }} />
              <span>{name}</span>
              <code>{variable}</code>
            </li>
          ))}
        </ul>
      </Card>

      <Card aria-labelledby="g-type">
        <h2 id="g-type">Type</h2>
        <h1 className={styles.sample3xl}>Heading one</h1>
        <h2 className={styles.sample2xl}>Heading two</h2>
        <h3 className={styles.sampleXl}>Heading three</h3>
        <p>Body text reads comfortably at sixteen pixels. नेपाली पाठ पनि यही फन्टमा देखिन्छ।</p>
        <p className={styles.muted}>Secondary text is quieter but still readable.</p>
      </Card>

      <Card aria-labelledby="g-buttons">
        <h2 id="g-buttons">Buttons</h2>
        <div className={styles.row}>
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="quiet">Quiet</Button>
          <Button disabled>Disabled</Button>
          <Button loading loadingLabel="Saving">
            Saving
          </Button>
        </div>
      </Card>

      <Card aria-labelledby="g-fields">
        <h2 id="g-fields">Fields</h2>
        <div className={styles.fields}>
          <Field label="Full name" name="a" hint="As on the citizenship certificate." />
          <Field label="Email" name="b" type="email" defaultValue="someone@example" error="Enter a full email address." />
        </div>
      </Card>

      <Card aria-labelledby="g-status">
        <h2 id="g-status">Badges and notices</h2>
        <div className={styles.row}>
          <Badge>Neutral</Badge>
          <Badge tone="ok">Paid</Badge>
          <Badge tone="bad">Overdue</Badge>
          <Badge tone="primary">Bachelor&apos;s</Badge>
        </div>
        <Notice title="Heads up">Neutral notices explain something without alarm.</Notice>
        <Notice tone="ok" title="Saved">The change was saved.</Notice>
        <Notice tone="bad" title="Could not save">Check the highlighted fields and try again.</Notice>
      </Card>

      <Card aria-labelledby="g-table">
        <h2 id="g-table">Table</h2>
        <Table caption="Recent payments" showCaption>
          <thead>
            <tr>
              <th scope="col">Receipt</th>
              <th scope="col">Student</th>
              <th scope="col">Amount</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>R-2083-0001</td>
              <td>Sample Student</td>
              <td>12,500</td>
              <td>
                <Badge tone="ok">Paid</Badge>
              </td>
            </tr>
            <tr>
              <td>R-2083-0002</td>
              <td>Another Student</td>
              <td>8,000</td>
              <td>
                <Badge tone="bad">Reversed</Badge>
              </td>
            </tr>
          </tbody>
        </Table>
      </Card>

      <Card aria-labelledby="g-loading">
        <h2 id="g-loading">Loading</h2>
        <div className={styles.row}>
          <Spinner label="Loading" />
          <Skeleton width="10rem" />
          <Skeleton width="6rem" height="2rem" />
        </div>
      </Card>
    </main>
  );
}
