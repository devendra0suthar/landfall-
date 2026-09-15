import { prisma } from '../lib/db.js';

/**
 * A candidate to develop against.
 *
 * Priya is the Jodhpur persona from docs/REQUIREMENTS.md §4 — deliberately not
 * a San Francisco engineer, because the questions that break this product are
 * the ones asked of someone applying across a border.
 */

const bullets = [
  'Built a Python and SQL pipeline that cut weekly reporting from 6 hours to 20 minutes.',
  'Automated quality checks in pandas, raising inter-annotator agreement from 0.71 to 0.89.',
  'Labelled 40,000 support tickets and shipped the taxonomy the analytics team still uses.',
  'Ran a weekly review with three stakeholders across product and support.',
  'Ran the office move and the vendor selection for it.',
];

const earlier = [
  'Rebuilt the daily ETL in Airflow; cut failed runs from 9 a month to 1.',
  'Wrote the runbook the on-call rotation still follows.',
  'Trained two interns on the reporting stack.',
  'Migrated 4 years of reporting history off a spreadsheet into Postgres.',
];

const candidate = await prisma.candidate.upsert({
  where: { email: 'priya.raman@fastmail.in' },
  create: { email: 'priya.raman@fastmail.in', region: 'ap-south-1' },
  update: {},
});

await prisma.profile.deleteMany({ where: { candidateId: candidate.id } });

const profile = await prisma.profile.create({
  data: {
    candidateId: candidate.id,
    firstName: 'Priya',
    lastName: 'Raman',
    email: 'priya.raman@fastmail.in',
    phone: '+91 98290 41765',
    location: 'Jodhpur, Rajasthan, India',
    city: 'Jodhpur',
    country: 'India',
    linkedin: 'https://www.linkedin.com/in/priyaraman',
    currentTitle: 'Data Operations Analyst',
    skills: ['python', 'sql', 'pandas', 'etl', 'tableau', 'data quality'],
    yearsExperience: 4,
  },
});

await prisma.role.create({
  data: {
    profileId: profile.id,
    title: 'Data Operations Analyst',
    company: 'Tessellate Labs',
    start: 'Jun 2023',
    location: 'Jodhpur',
    position: 0,
    bullets: { create: bullets.map((text, i) => ({ text, position: i })) },
  },
});

await prisma.role.create({
  data: {
    profileId: profile.id,
    title: 'Analyst',
    company: 'Marwar Systems',
    start: 'Aug 2021',
    end: 'May 2023',
    location: 'Jodhpur',
    position: 1,
    bullets: { create: earlier.map((text, i) => ({ text, position: i })) },
  },
});

// Recurring answers. Nine questions cover half of every form in the sample, so
// this list is short before it is useful — and it holds nothing that belongs to
// the candidate alone: no consent, no demographics, no attestation.
const bank: Array<[string, string]> = [
  ['notice period', '30 days'],
  ['willing to relocate', 'Yes, within India'],
  ['how did you hear about us', 'Job board'],
  ['current company', 'Tessellate Labs'],
  ['salary expectations', 'Open to discussion'],
];

for (const [labelKey, value] of bank) {
  await prisma.bankAnswer.upsert({
    where: { candidateId_labelKey: { candidateId: candidate.id, labelKey } },
    create: { candidateId: candidate.id, labelKey, value },
    update: { value },
  });
}

console.log(`seeded ${profile.firstName} ${profile.lastName}`
  + ` · 2 roles · ${bullets.length + earlier.length} bullets · ${bank.length} banked answers`);
process.exit(0);
