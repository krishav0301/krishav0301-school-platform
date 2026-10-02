// Precondition P2: the Accountant's money work after the Principal approved the fee structures. Ends with a
// discount, a second discount, a refund, a reversal and the corrected BBS structure waiting in the Principal's inbox.
const crypto = require("crypto");
const { secrets, saveSecrets } = require("./lib.cjs");
const { person } = require("./people-api.cjs");

const nepalToday = () => new Date(Date.now() + 345 * 60_000).toISOString().slice(0, 10);
const key = () => crypto.randomUUID().replace(/-/g, "");

(async () => {
  const y = secrets().year;
  const gita = await person("gita.thapa@school.example");
  const aarav = await person(y.students["Aarav Mandal"].email);

  for (const [k, cls] of [["g11", y.g11], ["g12", y.g12]]) {
    const made = await gita("POST", `/api/fees/structures/${y.structures[k]}/charges`, { classId: cls });
    console.log("charged", k, made);
  }
  const dues = await gita("GET", `/api/fees/dues?classId=${y.g11}`);
  const enr = (first) => dues.students.find((s) => s.studentName.startsWith(first)).enrollmentId;
  const dues12 = await gita("GET", `/api/fees/dues?classId=${y.g12}`);
  const enr12 = (first) => dues12.students.find((s) => s.studentName.startsWith(first)).enrollmentId;

  let wrong = { paymentId: secrets().money?.wrongPayment }, discount = { id: null };
  if (!process.env.RESUME) {
  // Cash payments (one retried with the same key: one receipt).
  const k1 = key();
  await gita("POST", "/api/fees/payments/cash", { enrollmentId: enr("Aarav"), amountPaisa: 1_500_000, idempotencyKey: k1, memo: "Admission fee" });
  await gita("POST", "/api/fees/payments/cash", { enrollmentId: enr("Aarav"), amountPaisa: 1_500_000, idempotencyKey: k1, memo: "Admission fee" });
  await gita("POST", "/api/fees/payments/cash", { enrollmentId: enr("Sita"), amountPaisa: 2_000_000, idempotencyKey: key() });
  await gita("POST", "/api/fees/payments/cash", { enrollmentId: enr("Suman"), amountPaisa: 1_850_000, idempotencyKey: key() });
  await gita("POST", "/api/fees/payments/cash", { enrollmentId: enr12("Deepak"), amountPaisa: 1_000_000, idempotencyKey: key() });
  // An overpayment by Puja, to be refunded.
  await gita("POST", "/api/fees/payments/cash", { enrollmentId: enr("Puja"), amountPaisa: 9_000_000, idempotencyKey: key(), memo: "Paid the whole year and more" });
  // A payment entered on the wrong student (Nabin), to be reversed.
  wrong = await gita("POST", "/api/fees/payments/cash", { enrollmentId: enr("Nabin"), amountPaisa: 500_000, idempotencyKey: key() });
  saveSecrets({ money: { wrongPayment: wrong.paymentId } });

  // Aarav pays a bank voucher; the Accountant verifies it.
  const voucher = await aarav("POST", "/api/fees/me/vouchers", { amountPaisa: 350_000, bank: "Nabil Bank", reference: "NB-2083-0616-7781", paidOn: nepalToday() });
  await gita("POST", `/api/fees/vouchers/${voucher.id}/verify`, {});
  console.log("payments recorded");

  // Requests for the Principal.
  discount = await gita("POST", `/api/fees/enrollments/${enr("Sita")}/discounts`, { percent: 10, reason: "sibling", note: "Her brother Rohit is in Grade 12" });
  }
  const discount2 = await gita("POST", `/api/fees/enrollments/${enr("Rohan")}/discounts`, { percent: 50, reason: "other", note: "Father asked for half fees" });
  const account = await gita("GET", `/api/fees/enrollments/${enr("Puja")}`);
  const refund = await gita("POST", `/api/fees/enrollments/${enr("Puja")}/refunds`, { amountPaisa: Math.min(2_000_000, account.creditPaisa), reason: "Paid more than the year's fees; the family asked for the extra back" });
  const reversal = await gita("POST", `/api/fees/payments/${wrong.paymentId}/reversal`, { reason: "Entered on the wrong student: it was Nabin Thakur's brother's payment" });

  // The declined BBS structure: corrected and sent again.
  const bbs = await gita("GET", `/api/fees/structures/${y.structures.bbs1}`).catch((e) => ({ error: e.message }));
  console.log("bbs structure:", JSON.stringify(bbs).slice(0, 300));
  try {


    await gita("POST", `/api/fees/structures/${y.structures.bbs1}/send`, {});
    console.log("bbs resent");
  } catch (e) {
    console.log("bbs resend:", e.message);
  }
  saveSecrets({ money: { discount: discount.id, discount2: discount2.id, refund: refund.id, reversal: reversal.id, wrongPayment: wrong.paymentId } });
  console.log("P2 done");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
