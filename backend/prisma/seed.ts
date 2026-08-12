/**
 * Demo seed — builds two organizations with a full lifecycle of data so the
 * whole product flow (committee → events → registration → attendance →
 * feedback → analytics) is visible without clicking anything into existence.
 *
 * Idempotent: every run wipes the demo orgs (by slug) and rebuilds them.
 * Never point this at a production database.
 *
 *   npm run prisma:seed
 */
import { PrismaClient, Prisma, Role, MemberStatus, EventStatus, RegistrationStatus, AttendanceStatus, FormFieldType, AssetCondition, FileCategory } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

const POLICY_VERSION = 'v1';
const DEMO_PASSWORD = 'Password123!';
const DEMO_SLUGS = ['tech-innovators', 'photography-club'];

const day = 86_400_000;
const at = (daysFromNow: number, hour = 9) => {
  const d = new Date(Date.now() + daysFromNow * day);
  d.setHours(hour, 0, 0, 0);
  return d;
};

type PersonSeed = {
  email: string;
  fullName: string;
  role: Role;
  status?: MemberStatus;
  studentId?: string;
  faculty?: string;
  programme?: string;
  intake?: string;
  phone?: string;
  committeeHistory?: { role: string; until: string }[];
};

const techPeople: PersonSeed[] = [
  { email: 'aisyah@demo.test', fullName: 'Nur Aisyah Rahman', role: Role.PRESIDENT, studentId: 'A21CS0101', faculty: 'Computing', programme: 'BSc Computer Science', intake: '2021/2022', phone: '+60123400101',
    committeeHistory: [{ role: 'SECRETARY', until: at(-365).toISOString() }, { role: 'VICE_PRESIDENT', until: at(-200).toISOString() }] },
  { email: 'daniel@demo.test', fullName: 'Daniel Wong Jia Hao', role: Role.VICE_PRESIDENT, studentId: 'A21CS0114', faculty: 'Computing', programme: 'BSc Software Engineering', intake: '2021/2022', phone: '+60123400114',
    committeeHistory: [{ role: 'COMMITTEE', until: at(-200).toISOString() }] },
  { email: 'priya@demo.test', fullName: 'Priya Kumaraswamy', role: Role.SECRETARY, studentId: 'A22CS0208', faculty: 'Computing', programme: 'BSc Data Engineering', intake: '2022/2023', phone: '+60123400208' },
  { email: 'haziq@demo.test', fullName: 'Haziq Ismail', role: Role.TREASURER, studentId: 'A22AC0330', faculty: 'Accounting', programme: 'BAcc Accounting', intake: '2022/2023', phone: '+60123400330' },
  { email: 'meiling@demo.test', fullName: 'Tan Mei Ling', role: Role.EVENT_DIRECTOR, studentId: 'A22CS0177', faculty: 'Computing', programme: 'BSc Computer Science', intake: '2022/2023', phone: '+60123400177' },
  { email: 'arjun@demo.test', fullName: 'Arjun Nair', role: Role.COMMITTEE, studentId: 'A23CS0412', faculty: 'Computing', programme: 'BSc Cybersecurity', intake: '2023/2024', phone: '+60123400412' },
  { email: 'sofia@demo.test', fullName: 'Sofia Abdullah', role: Role.COMMITTEE, studentId: 'A23DS0455', faculty: 'Design', programme: 'BA Interaction Design', intake: '2023/2024', phone: '+60123400455' },
  { email: 'advisor@demo.test', fullName: 'Dr. Lim Chee Keong', role: Role.ADVISOR, faculty: 'Computing', phone: '+60123400001' },
  { email: 'farah@demo.test', fullName: 'Farah Zainal', role: Role.VOLUNTEER, studentId: 'A24CS0510', faculty: 'Computing', programme: 'BSc Computer Science', intake: '2024/2025' },
  { email: 'kelvin@demo.test', fullName: 'Kelvin Ooi', role: Role.VOLUNTEER, studentId: 'A24EE0533', faculty: 'Engineering', programme: 'BEng Electronics', intake: '2024/2025' },
  { email: 'amir@demo.test', fullName: 'Amir Hakim', role: Role.PARTICIPANT, studentId: 'A24CS0601', faculty: 'Computing', programme: 'BSc Software Engineering', intake: '2024/2025' },
  { email: 'chloe@demo.test', fullName: 'Chloe Teh Xin Yi', role: Role.PARTICIPANT, studentId: 'A24BM0620', faculty: 'Business', programme: 'BBA Marketing', intake: '2024/2025' },
  { email: 'ravi@demo.test', fullName: 'Ravi Chandran', role: Role.PARTICIPANT, studentId: 'A23CS0388', faculty: 'Computing', programme: 'BSc Data Engineering', intake: '2023/2024' },
  { email: 'siti@demo.test', fullName: 'Siti Nurhaliza Omar', role: Role.PARTICIPANT, studentId: 'A24CS0644', faculty: 'Computing', programme: 'BSc Cybersecurity', intake: '2024/2025' },
  { email: 'jason@demo.test', fullName: 'Jason Lee Wei Sheng', role: Role.PARTICIPANT, studentId: 'A23EE0290', faculty: 'Engineering', programme: 'BEng Mechatronics', intake: '2023/2024' },
  { email: 'nadia@demo.test', fullName: 'Nadia Yusof', role: Role.PARTICIPANT, status: MemberStatus.ALUMNI, studentId: 'A19CS0044', faculty: 'Computing', programme: 'BSc Computer Science', intake: '2019/2020',
    committeeHistory: [{ role: 'TREASURER', until: at(-400).toISOString() }, { role: 'PRESIDENT', until: at(-365).toISOString() }] },
];

const photoPeople: PersonSeed[] = [
  { email: 'daniel@demo.test', fullName: 'Daniel Wong Jia Hao', role: Role.PRESIDENT },
  { email: 'chloe@demo.test', fullName: 'Chloe Teh Xin Yi', role: Role.SECRETARY },
  { email: 'kelvin@demo.test', fullName: 'Kelvin Ooi', role: Role.COMMITTEE },
  { email: 'amir@demo.test', fullName: 'Amir Hakim', role: Role.PARTICIPANT },
];

async function wipeDemoOrgs() {
  const orgs = await prisma.organization.findMany({ where: { slug: { in: DEMO_SLUGS } }, select: { id: true } });
  const orgIds = orgs.map((o) => o.id);
  if (orgIds.length === 0) return;

  const events = await prisma.event.findMany({ where: { organizationId: { in: orgIds } }, select: { id: true } });
  const eventIds = events.map((e) => e.id);
  const registrations = await prisma.registration.findMany({ where: { organizationId: { in: orgIds } }, select: { id: true, consentRecordId: true } });

  const certs = await prisma.certificate.findMany({ where: { organizationId: { in: orgIds } }, select: { id: true } });
  await prisma.certificateDownload.deleteMany({ where: { certificateId: { in: certs.map((c) => c.id) } } });
  await prisma.certificate.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.feedbackResponse.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.attendance.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.registration.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.consentRecord.deleteMany({ where: { id: { in: registrations.map((r) => r.consentRecordId) } } });
  await prisma.formField.deleteMany({ where: { registrationForm: { eventId: { in: eventIds } } } });
  await prisma.registrationForm.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.event.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.meetingMinutes.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.asset.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.achievement.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.galleryPhoto.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.orgFile.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.auditLog.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.membership.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
}

async function upsertUser(email: string, fullName: string, passwordHash: string) {
  const user = await prisma.user.upsert({
    where: { email },
    update: { fullName, passwordHash, deletedAt: null },
    create: { email, fullName, passwordHash },
  });
  const hasAccountConsent = await prisma.consentRecord.findFirst({ where: { userId: user.id, purpose: 'account' } });
  if (!hasAccountConsent) {
    await prisma.consentRecord.create({ data: { userId: user.id, purpose: 'account', policyVersion: POLICY_VERSION } });
  }
  return user;
}

/** Mirrors RegistrationsService: consent record → registration → attendance row for APPROVED. */
async function register(opts: {
  eventId: string;
  organizationId: string;
  userId: string;
  status: RegistrationStatus;
  createdAt: Date;
  answers?: Prisma.InputJsonValue;
  attendance?: { status: AttendanceStatus; scannedAt?: Date; scannedBy?: string };
}) {
  const consent = await prisma.consentRecord.create({
    data: { userId: opts.userId, purpose: 'event-registration', policyVersion: POLICY_VERSION, grantedAt: opts.createdAt },
  });
  const registration = await prisma.registration.create({
    data: {
      eventId: opts.eventId,
      organizationId: opts.organizationId,
      userId: opts.userId,
      status: opts.status,
      answers: opts.answers,
      consentRecordId: consent.id,
      createdAt: opts.createdAt,
    },
  });
  if (opts.status === RegistrationStatus.APPROVED) {
    await prisma.attendance.create({
      data: {
        registrationId: registration.id,
        eventId: opts.eventId,
        organizationId: opts.organizationId,
        status: opts.attendance?.status ?? AttendanceStatus.REGISTERED,
        scannedAt: opts.attendance?.scannedAt ?? null,
        scannedBy: opts.attendance?.scannedBy ?? null,
        createdAt: opts.createdAt,
      },
    });
  }
  await prisma.auditLog.create({
    data: {
      organizationId: opts.organizationId,
      actorUserId: opts.userId,
      action: 'registration.create',
      targetType: 'Registration',
      targetId: registration.id,
      metadata: { registrationId: registration.id, eventId: opts.eventId, status: opts.status },
      createdAt: opts.createdAt,
    },
  });
  return registration;
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed demo data with NODE_ENV=production');
  }

  console.log('Wiping previous demo data…');
  await wipeDemoOrgs();

  const passwordHash = await argon2.hash(DEMO_PASSWORD);

  // ---------------------------------------------------------------- users
  const allPeople = [...techPeople, ...photoPeople.filter((p) => !techPeople.some((t) => t.email === p.email))];
  const users: Record<string, { id: string; fullName: string }> = {};
  for (const person of allPeople) {
    users[person.email] = await upsertUser(person.email, person.fullName, passwordHash);
  }
  console.log(`Users ready: ${Object.keys(users).length}`);

  // ------------------------------------------------------- org 1: tech
  const tech = await prisma.organization.create({
    data: {
      name: 'Tech Innovators Society',
      slug: 'tech-innovators',
      description:
        'The campus hub for builders — weekly workshops, an annual hackathon, and industry nights connecting students with practising engineers.',
      primaryColor: '#6366f1',
      secondaryColor: '#1e1b4b',
      storageQuotaMb: 2048,
      advisors: ['Dr. Lim Chee Keong', 'Assoc. Prof. Farida Hassan'],
      socialLinks: {
        instagram: 'https://instagram.com/techinnovators',
        linkedin: 'https://linkedin.com/company/tech-innovators-society',
        website: 'https://techinnovators.example.edu',
      },
      createdAt: at(-420),
    },
  });

  const techMembership: Record<string, string> = {};
  for (const person of techPeople) {
    const membership = await prisma.membership.create({
      data: {
        userId: users[person.email].id,
        organizationId: tech.id,
        role: person.role,
        status: person.status ?? MemberStatus.ACTIVE,
        studentId: person.studentId,
        faculty: person.faculty,
        programme: person.programme,
        intake: person.intake,
        phone: person.phone,
        committeeHistory: person.committeeHistory as Prisma.InputJsonValue | undefined,
        joinedAt: at(-380 + techPeople.indexOf(person) * 9),
      },
    });
    techMembership[person.email] = membership.id;
  }
  console.log(`Tech Innovators Society: ${techPeople.length} members`);

  const president = users['aisyah@demo.test'];
  const eventDirector = users['meiling@demo.test'];

  // -------------------------------------------------------------- events
  // 0. Oldest completed event — gives feedback and the NPS/ratings trends a
  //    third data point, so the analytics charts read as trends rather than
  //    two lonely dots.
  const cloudTalk = await prisma.event.create({
    data: {
      organizationId: tech.id,
      title: 'Industry Talk: Careers in Cloud',
      description:
        'Three engineers from a regional cloud provider on how they got in, what they actually do all day, and which certifications were worth the money. Q&A and pizza afterwards.',
      venue: 'Auditorium B',
      startAt: at(-42, 19),
      endAt: at(-42, 21),
      capacity: 80,
      status: EventStatus.COMPLETED,
      createdByUserId: eventDirector.id,
      createdAt: at(-60),
    },
  });

  // 1. Completed workshop — full attendance + feedback history.
  const mlWorkshop = await prisma.event.create({
    data: {
      organizationId: tech.id,
      title: 'Intro to Machine Learning Workshop',
      description:
        'A hands-on afternoon covering supervised learning fundamentals, scikit-learn pipelines, and evaluating a first model. Laptops required; no prior ML experience needed.',
      venue: 'N28 Computer Lab 3',
      startAt: at(-21, 14),
      endAt: at(-21, 18),
      capacity: 40,
      status: EventStatus.COMPLETED,
      createdByUserId: eventDirector.id,
      createdAt: at(-45),
    },
  });

  // 2. Upcoming hackathon — capacity 6 so the waitlist is visible, custom form.
  const hackathon = await prisma.event.create({
    data: {
      organizationId: tech.id,
      title: 'Tech Innovators Hackathon 2026',
      description:
        '36 hours, four tracks (AI, campus life, sustainability, open), RM5,000 prize pool. Teams of 3–5. Mentors from three industry partners on site throughout.',
      venue: 'Innovation Hall, Level 2',
      startAt: at(12, 9),
      endAt: at(13, 21),
      capacity: 6,
      status: EventStatus.PUBLISHED,
      requireFeedbackForCertificate: true,
      createdByUserId: eventDirector.id,
      createdAt: at(-20),
    },
  });
  const hackForm = await prisma.registrationForm.create({ data: { eventId: hackathon.id } });
  await prisma.formField.createMany({
    data: [
      { registrationFormId: hackForm.id, label: 'Team name', type: FormFieldType.TEXT, required: true, order: 1 },
      { registrationFormId: hackForm.id, label: 'Track', type: FormFieldType.SELECT, required: true, order: 2, options: ['AI', 'Campus Life', 'Sustainability', 'Open'] },
      { registrationFormId: hackForm.id, label: 'T-shirt size', type: FormFieldType.SELECT, required: true, order: 3, options: ['S', 'M', 'L', 'XL'] },
      { registrationFormId: hackForm.id, label: 'Dietary requirements', type: FormFieldType.TEXTAREA, required: false, order: 4 },
      { registrationFormId: hackForm.id, label: 'I agree to the code of conduct', type: FormFieldType.CHECKBOX, required: true, order: 5 },
    ],
  });

  // 3. AGM in three days — open registrations, plenty of headroom.
  const agm = await prisma.event.create({
    data: {
      organizationId: tech.id,
      title: 'Annual General Meeting 2026',
      description:
        'Presentation of the annual report and audited accounts, followed by committee elections for the 2026/2027 session. Open to all active members.',
      venue: 'Dewan Kuliah Utama',
      startAt: at(3, 15),
      endAt: at(3, 18),
      capacity: 60,
      status: EventStatus.PUBLISHED,
      createdByUserId: users['priya@demo.test'].id,
      createdAt: at(-10),
    },
  });

  // 4. Draft — not visible to participants yet.
  await prisma.event.create({
    data: {
      organizationId: tech.id,
      title: 'Industry Career Night',
      description:
        'Recruiter booths, CV clinic, and a panel with alumni working in cloud, security, and data roles. Sponsor confirmations pending — do not publish yet.',
      venue: 'TBC — negotiating Auditorium A',
      startAt: at(31, 18),
      endAt: at(31, 22),
      capacity: 120,
      status: EventStatus.DRAFT,
      createdByUserId: eventDirector.id,
      createdAt: at(-4),
    },
  });

  // 5. Finished but not yet closed out: attendance is marked and feedback is in,
  //     so marking it COMPLETED in the UI kicks off real certificate generation
  //     (gated on feedback) instead of leaving a dead COMPLETED event behind.
  const bootcamp = await prisma.event.create({
    data: {
      organizationId: tech.id,
      title: 'Weekend Coding Bootcamp: Git & GitHub',
      description:
        'Two-day intensive on version control: branching models, resolving conflicts, pull request review, and shipping a first open-source contribution.',
      venue: 'N28 Seminar Room 1',
      startAt: at(-7, 9),
      endAt: at(-6, 17),
      capacity: 25,
      status: EventStatus.PUBLISHED,
      requireFeedbackForCertificate: true,
      createdByUserId: eventDirector.id,
      createdAt: at(-30),
    },
  });

  // ------------------------------------------------- registrations & attendance
  const mlRoster: { email: string; attended: boolean }[] = [
    { email: 'amir@demo.test', attended: true },
    { email: 'chloe@demo.test', attended: true },
    { email: 'ravi@demo.test', attended: true },
    { email: 'siti@demo.test', attended: true },
    { email: 'jason@demo.test', attended: false },
    { email: 'farah@demo.test', attended: true },
    { email: 'kelvin@demo.test', attended: true },
    { email: 'arjun@demo.test', attended: true },
    { email: 'sofia@demo.test', attended: false },
    { email: 'nadia@demo.test', attended: true },
    { email: 'daniel@demo.test', attended: true },
    { email: 'haziq@demo.test', attended: false },
  ];
  for (const [i, row] of mlRoster.entries()) {
    await register({
      eventId: mlWorkshop.id,
      organizationId: tech.id,
      userId: users[row.email].id,
      status: RegistrationStatus.APPROVED,
      createdAt: at(-35 + i),
      attendance: row.attended
        ? { status: AttendanceStatus.PRESENT, scannedAt: at(-21, 14), scannedBy: eventDirector.id }
        : { status: AttendanceStatus.ABSENT },
    });
  }

  const mlFeedback: { email: string; nps: number; content: number; org: number; venue: number; comment?: string }[] = [
    { email: 'amir@demo.test', nps: 10, content: 5, org: 5, venue: 4, comment: 'Best workshop I have attended on campus. The pipeline exercise finally made it click.' },
    { email: 'chloe@demo.test', nps: 9, content: 5, org: 4, venue: 4, comment: 'Great pacing for a non-CS student. Would love a follow-up session.' },
    { email: 'ravi@demo.test', nps: 8, content: 4, org: 4, venue: 3, comment: 'Solid content, but the lab machines were slow to set up Python.' },
    { email: 'siti@demo.test', nps: 9, content: 5, org: 5, venue: 4 },
    { email: 'farah@demo.test', nps: 7, content: 4, org: 4, venue: 3, comment: 'Ran about 30 minutes over. Otherwise good.' },
    { email: 'kelvin@demo.test', nps: 10, content: 5, org: 5, venue: 5, comment: 'Speaker was excellent and the slides were shared straight after.' },
    { email: 'arjun@demo.test', nps: 6, content: 3, org: 4, venue: 3, comment: 'A bit basic if you have already done the ML elective.' },
    { email: 'nadia@demo.test', nps: 9, content: 5, org: 4, venue: 4 },
    { email: 'daniel@demo.test', nps: 8, content: 4, org: 5, venue: 4, comment: 'Good turnout and the room was set up early for once.' },
  ];
  for (const f of mlFeedback) {
    await prisma.feedbackResponse.create({
      data: {
        eventId: mlWorkshop.id,
        organizationId: tech.id,
        userId: users[f.email].id,
        npsScore: f.nps,
        contentRating: f.content,
        organizationRating: f.org,
        venueRating: f.venue,
        comment: f.comment,
        createdAt: at(-20),
      },
    });
  }

  const cloudRoster: { email: string; attended: boolean }[] = [
    { email: 'amir@demo.test', attended: true },
    { email: 'chloe@demo.test', attended: true },
    { email: 'ravi@demo.test', attended: true },
    { email: 'siti@demo.test', attended: true },
    { email: 'jason@demo.test', attended: true },
    { email: 'farah@demo.test', attended: true },
    { email: 'kelvin@demo.test', attended: true },
    { email: 'arjun@demo.test', attended: true },
    { email: 'sofia@demo.test', attended: true },
    { email: 'nadia@demo.test', attended: true },
    { email: 'daniel@demo.test', attended: true },
    { email: 'priya@demo.test', attended: true },
    { email: 'haziq@demo.test', attended: false },
    { email: 'meiling@demo.test', attended: false },
  ];
  for (const [i, row] of cloudRoster.entries()) {
    await register({
      eventId: cloudTalk.id,
      organizationId: tech.id,
      userId: users[row.email].id,
      status: RegistrationStatus.APPROVED,
      createdAt: at(-55 + i),
      attendance: row.attended
        ? { status: AttendanceStatus.PRESENT, scannedAt: at(-42, 19), scannedBy: eventDirector.id }
        : { status: AttendanceStatus.ABSENT },
    });
  }

  const cloudFeedback = [
    { email: 'amir@demo.test', nps: 9, content: 5, org: 4, venue: 4, comment: 'Hearing what the job is actually like day to day was worth more than any careers fair.' },
    { email: 'chloe@demo.test', nps: 8, content: 4, org: 4, venue: 5, comment: 'Not my field but I followed all of it. Good speakers.' },
    { email: 'ravi@demo.test', nps: 10, content: 5, org: 5, venue: 4, comment: 'The certification advice alone saved me about RM2,000 on courses I was about to buy.' },
    { email: 'siti@demo.test', nps: 9, content: 5, org: 4, venue: 4 },
    { email: 'jason@demo.test', nps: 7, content: 4, org: 4, venue: 3, comment: 'Auditorium B has terrible sound at the back. Sit near the front.' },
    { email: 'farah@demo.test', nps: 8, content: 4, org: 5, venue: 4, comment: 'Q&A ran long in a good way — nobody left early.' },
    { email: 'kelvin@demo.test', nps: 6, content: 3, org: 4, venue: 3, comment: 'Pitched at first-years. I wanted more depth on architecture.' },
    { email: 'arjun@demo.test', nps: 9, content: 5, org: 4, venue: 4 },
    { email: 'sofia@demo.test', nps: 10, content: 5, org: 5, venue: 5, comment: 'Got an internship referral out of this. Please run it again next semester.' },
    { email: 'nadia@demo.test', nps: 8, content: 4, org: 4, venue: 4, comment: 'As an alum: this is the session I wish existed in my first year.' },
    { email: 'daniel@demo.test', nps: 9, content: 4, org: 5, venue: 4 },
    { email: 'priya@demo.test', nps: 7, content: 4, org: 3, venue: 4, comment: 'Pizza arrived 40 minutes late and we had already lost half the room.' },
  ];
  for (const f of cloudFeedback) {
    await prisma.feedbackResponse.create({
      data: {
        eventId: cloudTalk.id,
        organizationId: tech.id,
        userId: users[f.email].id,
        npsScore: f.nps,
        contentRating: f.content,
        organizationRating: f.org,
        venueRating: f.venue,
        comment: f.comment,
        createdAt: at(-40),
      },
    });
  }

  const bootcampRoster: { email: string; attended: boolean }[] = [
    { email: 'amir@demo.test', attended: true },
    { email: 'siti@demo.test', attended: true },
    { email: 'jason@demo.test', attended: true },
    { email: 'ravi@demo.test', attended: true },
    { email: 'chloe@demo.test', attended: false },
    { email: 'farah@demo.test', attended: true },
    { email: 'sofia@demo.test', attended: true },
    { email: 'arjun@demo.test', attended: true },
    { email: 'kelvin@demo.test', attended: false },
    { email: 'nadia@demo.test', attended: true },
  ];
  for (const [i, row] of bootcampRoster.entries()) {
    await register({
      eventId: bootcamp.id,
      organizationId: tech.id,
      userId: users[row.email].id,
      status: RegistrationStatus.APPROVED,
      createdAt: at(-25 + i),
      attendance: row.attended
        ? { status: AttendanceStatus.PRESENT, scannedAt: at(-7, 9), scannedBy: eventDirector.id }
        : { status: AttendanceStatus.ABSENT },
    });
  }

  const bootcampFeedback = [
    { email: 'amir@demo.test', nps: 9, content: 5, org: 4, venue: 4, comment: 'Conflict resolution walkthrough was worth the whole weekend.' },
    { email: 'siti@demo.test', nps: 10, content: 5, org: 5, venue: 5, comment: 'Merged my first PR to a real project. Thank you!' },
    { email: 'jason@demo.test', nps: 7, content: 4, org: 3, venue: 4, comment: 'Day two started late and we rushed the last module.' },
    { email: 'ravi@demo.test', nps: 8, content: 4, org: 4, venue: 4 },
    { email: 'farah@demo.test', nps: 9, content: 5, org: 5, venue: 4 },
    { email: 'arjun@demo.test', nps: 8, content: 4, org: 5, venue: 3, comment: 'Room was cold but the mentors were very patient.' },
    { email: 'sofia@demo.test', nps: 10, content: 5, org: 5, venue: 4, comment: 'Two days well spent. The branching diagrams are on my wall now.' },
    { email: 'nadia@demo.test', nps: 6, content: 4, org: 3, venue: 4, comment: 'Wi-fi dropped repeatedly on day one, which is rough for a Git workshop.' },
  ];
  for (const f of bootcampFeedback) {
    await prisma.feedbackResponse.create({
      data: {
        eventId: bootcamp.id,
        organizationId: tech.id,
        userId: users[f.email].id,
        npsScore: f.nps,
        contentRating: f.content,
        organizationRating: f.org,
        venueRating: f.venue,
        comment: f.comment,
        createdAt: at(-5),
      },
    });
  }

  // Hackathon: capacity 6 → first six APPROVED, remainder WAITLISTED.
  const hackRoster = [
    { email: 'amir@demo.test', team: 'Null Pointers', track: 'AI', size: 'M' },
    { email: 'chloe@demo.test', team: 'Null Pointers', track: 'AI', size: 'S' },
    { email: 'siti@demo.test', team: 'Segfault', track: 'Sustainability', size: 'M' },
    { email: 'jason@demo.test', team: 'Segfault', track: 'Sustainability', size: 'L' },
    { email: 'ravi@demo.test', team: 'Kernel Panic', track: 'Campus Life', size: 'L' },
    { email: 'farah@demo.test', team: 'Kernel Panic', track: 'Campus Life', size: 'S' },
    { email: 'kelvin@demo.test', team: 'Stack Overflowers', track: 'Open', size: 'XL' },
    { email: 'nadia@demo.test', team: 'Stack Overflowers', track: 'Open', size: 'M' },
    { email: 'sofia@demo.test', team: 'Pixel Pushers', track: 'Campus Life', size: 'S' },
  ];
  for (const [i, r] of hackRoster.entries()) {
    await register({
      eventId: hackathon.id,
      organizationId: tech.id,
      userId: users[r.email].id,
      status: i < 6 ? RegistrationStatus.APPROVED : RegistrationStatus.WAITLISTED,
      createdAt: at(-18 + i),
      answers: {
        'Team name': r.team,
        Track: r.track,
        'T-shirt size': r.size,
        'Dietary requirements': i % 4 === 0 ? 'Vegetarian' : '',
        'I agree to the code of conduct': true,
      },
    });
  }

  // AGM: broad committee + member turnout, all still REGISTERED (event upcoming).
  const agmRoster = ['daniel@demo.test', 'priya@demo.test', 'haziq@demo.test', 'meiling@demo.test', 'arjun@demo.test', 'sofia@demo.test', 'farah@demo.test', 'amir@demo.test', 'ravi@demo.test', 'siti@demo.test'];
  for (const [i, email] of agmRoster.entries()) {
    await register({
      eventId: agm.id,
      organizationId: tech.id,
      userId: users[email].id,
      status: RegistrationStatus.APPROVED,
      createdAt: at(-9 + i * 0.5),
    });
  }
  console.log('Events seeded: 6 (2 completed, 3 published, 1 draft)');

  // ------------------------------------------------------ committee records
  const attendeeIds = ['aisyah@demo.test', 'daniel@demo.test', 'priya@demo.test', 'haziq@demo.test', 'meiling@demo.test', 'arjun@demo.test'].map((e) => techMembership[e]);
  await prisma.meetingMinutes.create({
    data: {
      organizationId: tech.id,
      title: 'Committee Meeting #7 — Hackathon Readiness',
      meetingDate: at(-14, 20),
      attendeeMembershipIds: attendeeIds,
      agendaItems: [
        { topic: 'Sponsorship status', notes: 'Two of four sponsors confirmed (RM3,000 secured). Third sponsor awaiting internal approval; fourth declined.' },
        { topic: 'Venue booking', notes: 'Innovation Hall confirmed for both days. AV package included; extension cords to be borrowed from the faculty.' },
        { topic: 'Judging criteria', notes: 'Agreed on innovation 30%, execution 30%, impact 25%, presentation 15%.' },
      ],
      actionItems: [
        { task: 'Chase third sponsor for written confirmation by Friday', owner: 'Haziq Ismail' },
        { task: 'Publish mentor sign-up form to the alumni group', owner: 'Tan Mei Ling' },
        { task: 'Draft the participant briefing pack', owner: 'Priya Kumaraswamy' },
      ],
      createdByUserId: users['priya@demo.test'].id,
      createdAt: at(-14),
    },
  });
  await prisma.meetingMinutes.create({
    data: {
      organizationId: tech.id,
      title: 'Committee Meeting #8 — AGM Preparation',
      meetingDate: at(-5, 20),
      attendeeMembershipIds: [...attendeeIds, techMembership['sofia@demo.test'], techMembership['advisor@demo.test']],
      agendaItems: [
        { topic: 'Annual report', notes: 'Draft circulated; sections on membership growth and event impact still need the analytics export.' },
        { topic: 'Accounts', notes: 'Treasurer reported RM12,400 income against RM9,850 spend. Audit walkthrough scheduled with the advisor.' },
        { topic: 'Election process', notes: 'Nominations open one week before the AGM. Voting by show of hands, quorum set at 25 active members.' },
      ],
      actionItems: [
        { task: 'Attach analytics export to the annual report', owner: 'Nur Aisyah Rahman' },
        { task: 'Circulate nomination form to all active members', owner: 'Priya Kumaraswamy' },
        { task: 'Book projector and PA system for Dewan Kuliah Utama', owner: 'Arjun Nair' },
      ],
      createdByUserId: users['priya@demo.test'].id,
      createdAt: at(-5),
    },
  });

  await prisma.asset.createMany({
    data: [
      { organizationId: tech.id, name: 'Portable PA system (Yamaha StagePas)', quantity: 1, condition: AssetCondition.GOOD, location: 'Club room cabinet A', notes: 'Includes two speaker stands and a wireless mic.', createdByUserId: users['haziq@demo.test'].id },
      { organizationId: tech.id, name: 'Roll-up banner stands', quantity: 4, condition: AssetCondition.GOOD, location: 'Club room, behind door', createdByUserId: users['haziq@demo.test'].id },
      { organizationId: tech.id, name: 'Raspberry Pi 5 starter kits', quantity: 12, condition: AssetCondition.GOOD, location: 'N28 storage locker 3', notes: 'Used for the IoT workshop series. Two kits missing SD cards.', createdByUserId: users['arjun@demo.test'].id },
      { organizationId: tech.id, name: 'DSLR camera (Canon 700D)', quantity: 1, condition: AssetCondition.DAMAGED, location: 'With Sofia Abdullah', notes: 'Autofocus motor faulty since the last event. Quote for repair: RM320.', createdByUserId: users['sofia@demo.test'].id },
      { organizationId: tech.id, name: 'Extension cords (10m)', quantity: 6, condition: AssetCondition.LOST, location: 'Unaccounted for after hackathon 2025', notes: 'Two of eight recovered; write-off approved at Meeting #6.', createdByUserId: users['haziq@demo.test'].id },
    ],
  });

  await prisma.achievement.createMany({
    data: [
      { organizationId: tech.id, title: 'Best Student Society (Technology)', description: 'Awarded by the Student Affairs Division for consistent programme quality and membership growth across the 2025/2026 session.', year: 2026, createdByUserId: president.id },
      { organizationId: tech.id, title: 'National Collegiate Hackathon — Champion', description: 'Team Null Pointers placed first among 84 teams with an accessibility-focused campus navigation app.', year: 2025, createdByUserId: president.id },
      { organizationId: tech.id, title: 'Community Impact Grant Recipient', description: 'RM8,000 grant to run free coding bootcamps for six secondary schools in the district.', year: 2025, createdByUserId: users['daniel@demo.test'].id },
    ],
  });

  await prisma.auditLog.createMany({
    data: [
      { organizationId: tech.id, actorUserId: president.id, action: 'organization.update', targetType: 'Organization', targetId: tech.id, metadata: { fields: ['description', 'socialLinks'] }, createdAt: at(-40) },
      { organizationId: tech.id, actorUserId: president.id, action: 'membership.role_change', targetType: 'Membership', targetId: techMembership['daniel@demo.test'], metadata: { from: 'COMMITTEE', to: 'VICE_PRESIDENT' }, createdAt: at(-200) },
      { organizationId: tech.id, actorUserId: eventDirector.id, action: 'event.publish', targetType: 'Event', targetId: hackathon.id, metadata: { title: hackathon.title }, createdAt: at(-18) },
      { organizationId: tech.id, actorUserId: eventDirector.id, action: 'event.complete', targetType: 'Event', targetId: mlWorkshop.id, metadata: { title: mlWorkshop.title }, createdAt: at(-20) },
    ],
  });

  // -------------------------------------------------- org 2: photography
  const photo = await prisma.organization.create({
    data: {
      name: 'Campus Photography Club',
      slug: 'photography-club',
      description: 'Monthly photo walks, darkroom sessions, and a semesterly print exhibition. All skill levels and all cameras — phones included.',
      primaryColor: '#0f766e',
      secondaryColor: '#134e4a',
      advisors: ['Ms. Rachel Tan'],
      socialLinks: { instagram: 'https://instagram.com/campusphotoclub' },
      createdAt: at(-260),
    },
  });
  for (const [i, person] of photoPeople.entries()) {
    await prisma.membership.create({
      data: {
        userId: users[person.email].id,
        organizationId: photo.id,
        role: person.role,
        status: MemberStatus.ACTIVE,
        joinedAt: at(-250 + i * 12),
      },
    });
  }
  const photoWalk = await prisma.event.create({
    data: {
      organizationId: photo.id,
      title: 'Golden Hour Photo Walk — Old Town',
      description: 'Two-hour walk through the heritage quarter shooting street and architecture. Meet at the clock tower; bring a spare battery.',
      venue: 'Old Town heritage quarter',
      startAt: at(6, 17),
      endAt: at(6, 19),
      capacity: 20,
      status: EventStatus.PUBLISHED,
      createdByUserId: users['daniel@demo.test'].id,
      createdAt: at(-12),
    },
  });
  for (const [i, email] of ['chloe@demo.test', 'kelvin@demo.test', 'amir@demo.test'].entries()) {
    await register({
      eventId: photoWalk.id,
      organizationId: photo.id,
      userId: users[email].id,
      status: RegistrationStatus.APPROVED,
      createdAt: at(-8 + i),
    });
  }
  console.log('Campus Photography Club: 4 members, 1 published event');

  // ------------------------------------------------------------- summary
  const counts = {
    events: await prisma.event.count({ where: { organizationId: { in: [tech.id, photo.id] } } }),
    registrations: await prisma.registration.count({ where: { organizationId: { in: [tech.id, photo.id] } } }),
    attendance: await prisma.attendance.count({ where: { organizationId: { in: [tech.id, photo.id] } } }),
    feedback: await prisma.feedbackResponse.count({ where: { organizationId: { in: [tech.id, photo.id] } } }),
  };

  console.log('\n--- Demo data ready ---');
  console.log(counts);
  console.log(`\nAll accounts use the password: ${DEMO_PASSWORD}`);
  console.log('Sign in as:');
  console.log('  aisyah@demo.test   President          — full admin view of Tech Innovators Society');
  console.log('  meiling@demo.test  Event Director     — events, attendance, certificates');
  console.log('  haziq@demo.test    Treasurer          — assets, finance-side views');
  console.log('  daniel@demo.test   VP + Photo Club President — exercises the org switcher');
  console.log('  amir@demo.test     Participant        — registrations, feedback, my-events view');
  console.log('\nOrg URLs: /tech-innovators and /photography-club');
  console.log('\nFlows already primed:');
  console.log('  • "Weekend Coding Bootcamp" is PUBLISHED but finished, with attendance + 6 feedback');
  console.log('    responses in. Mark it completed → certificate generation runs for feedback-givers.');
  console.log('  • "Tech Innovators Hackathon 2026" has capacity 6 with 9 registrants → 3 waitlisted,');
  console.log('    plus a 5-field custom registration form.');
  console.log('  • "Industry Career Night" stays DRAFT — invisible to participants until published.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
