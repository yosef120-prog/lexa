import type { QuestionType } from "@/lib/intake";

/**
 * Questionnaires a firm can start from.
 *
 * Every one of these is a starting point and nothing more: the builder can
 * reword, reorder and remove anything here. They exist so the first link goes
 * out in a minute instead of an afternoon.
 */

export type TemplateQuestion = {
  type: QuestionType;
  label: string;
  help?: string;
  body?: string;
  required: boolean;
  options?: string[];
  /** 1-based index into the same list — the position the parent will be given. */
  dependsOn?: number;
  dependsValue?: string;
};

export type Template = {
  key: string;
  name: string;
  intro: string;
  note: string;
  questions: TemplateQuestion[];
};

/**
 * Selling an apartment, as an Israeli conveyancing practice actually asks it.
 *
 * Brought across from the questionnaire this firm was already sending, rather
 * than invented: the difference between "attach relevant documents" and "the
 * mortgage balance report, which you can get from your bank's app" is the
 * difference between a client who complies and one who asks what you mean.
 * Every line that tells somebody where to find a document is doing real work.
 */
const APARTMENT_SALE: Template = {
  key: "apartment-sale",
  name: "שאלון ללקוח שמוכר דירה",
  intro: "כמה פרטים ומסמכים כדי שנוכל להתחיל לטפל במכירה. אפשר למלא מהטלפון.",
  note: "מבוסס על השאלון שכבר שלחת ללקוחות. נוסח ייפוי הכוח דורש השלמה.",
  questions: [
    { type: "yes_no", label: "האם הדירה רשומה על שמך?", required: true },
    {
      type: "file",
      label: "צרף צילום תעודת זהות מקדימה ומאחורה כולל ספח",
      required: true,
    },
    {
      type: "file",
      label: "במידה ורכשת את הדירה שלך מקבלן צרף לי את הסכם הרכישה שלך מולו",
      required: false,
    },
    {
      type: "file",
      label: "צרף אישור מס רכישה",
      help: "מוציאים מהאזור האישי ברשות המיסים",
      required: true,
    },
    { type: "file", label: "שובר ארנונה", required: true },
    {
      type: "file",
      label: "צרף דוח יתרות משכנתא",
      help: "ניתן להוציא מהאפליקציה של הבנק",
      required: false,
    },
    {
      type: "file",
      label: "נסח טאבו ודוחות עיון",
      help: "כרוך בעמלה למדינה בסך כ‑40 ₪",
      required: true,
    },
    {
      type: "single_choice",
      label: "האם הדירה מושכרת או שאתם גרים בדירה?",
      options: ["מושכרת", "אנחנו גרים בדירה", "הדירה ריקה"],
      required: true,
    },
    { type: "yes_no", label: "האם היו תקלות ו/או ליקויים בדירה?", required: true },
    {
      type: "long_text",
      label: "פרט אילו תקלות או ליקויים היו, ומה תוקן",
      required: false,
      dependsOn: 9,
      dependsValue: "yes",
    },
    {
      type: "yes_no",
      label: "האם יש כיום תקלות ו/או ליקויים ו/או רטיבויות ו/או בעיות איטום בדירה?",
      required: true,
    },
    {
      type: "long_text",
      label: "פרט מה קיים כיום",
      // Disclosure to the buyer turns on this answer, so it is asked in
      // writing before the meeting rather than remembered from one.
      help: "חשוב לגילוי נאות מול הקונה",
      required: false,
      dependsOn: 11,
      dependsValue: "yes",
    },
    { type: "yes_no", label: "האם זו הדירה היחידה שבבעלותכם?", required: true },
    {
      type: "yes_no",
      label:
        "האם הינכם בעלי זכויות בדירה נוספת (לרבות חלק מדירה) שקיבלתם במתנה או בירושה?",
      required: true,
    },
    {
      type: "yes_no",
      label: "האם ביצעתם תוספת בנייה בדירה או שינוי פנימי (לדוגמה שבירת קירות)?",
      required: true,
    },
    {
      type: "long_text",
      label: "פרט מה בוצע, ומתי",
      help: "אם יש היתר — אפשר לצרף אותו בשאלה הבאה",
      required: false,
      dependsOn: 15,
      dependsValue: "yes",
    },
    {
      type: "file",
      label: "צרף אישור ניהול חשבון",
      help: "עדיף משותף ככל ומדובר בזוג נשוי",
      required: true,
    },
    {
      type: "text",
      label: "מה פריסת התשלומים עליה סוכם עם הקונה, ככל וסוכם?",
      required: false,
    },
    {
      type: "text",
      label: "מה תאריך מסירת החזקה (פינוי הדירה), ככל וסוכם עם הקונה?",
      required: false,
    },
    {
      type: "consent",
      label: "ייפוי כוח להוצאת אישורי מסים והזמנת מסמכים",
      body:
        "אני החתום/ה מטה מייפה בזאת את כוחו של עורך הדין לפעול בשמי ובמקומי לצורך " +
        "הטיפול במכירת הדירה מושא שאלון זה, ובכלל זה:\n\n" +
        "1. להוציא ולקבל אישורי מסים, לרבות אישור מס שבח, מס רכישה והיטל השבחה.\n" +
        "2. להזמין ולקבל מסמכים הרלוונטיים לדירה מכל רשות או גוף, לרבות נסח טאבו, " +
        "דוחות עיון, אישורי עירייה, ארנונה ומים.\n" +
        "3. לפנות לרשויות המס, לרשות מקרקעי ישראל, לעירייה ולוועדה המקומית לתכנון " +
        "ובנייה בכל עניין הנוגע לדירה.\n\n" +
        "ידוע לי כי ייפוי כוח זה ניתן לצורך הטיפול האמור בלבד, וכי אוכל לבטלו " +
        "בהודעה בכתב.",
      required: true,
    },
    {
      type: "consent",
      label: "שכר טרחה ולוח תשלומים",
      body:
        "שכר טרחה: 1.5% משווי העסקה, בתוספת מע״מ כדין.\n\n" +
        "לוח התשלומים:\n" +
        "50% במעמד הסכם המכר\n" +
        "50% בעת מסירת המפתח",
      required: true,
    },
    {
      type: "consent",
      label: "אישור והצהרה",
      body:
        "אני מאשר/ת שהפרטים שמסרתי נכונים ומלאים, ומסכים/ה לשימוש בהם לצורך " +
        "הטיפול בפנייתי.",
      required: true,
    },
    { type: "signature", label: "חתימה", required: true },
  ],
};

/**
 * A general first-meeting form, for matters that are not conveyancing.
 *
 * Two of its questions are conflict checks wearing ordinary clothes: another
 * lawyer already on the matter, and a deadline already running.
 */
const FIRST_MEETING: Template = {
  key: "first-meeting",
  name: "שאלון פתיחת תיק",
  intro: "כמה פרטים ומסמכים לפני הפגישה הראשונה. אפשר למלא מהטלפון.",
  note: "שאלון כללי לפתיחת תיק בכל תחום.",
  questions: [
    { type: "text", label: "שם מלא כפי שמופיע בתעודת הזהות", required: true },
    { type: "text", label: "מספר תעודת זהות", required: true },
    { type: "text", label: "כתובת מלאה", required: true },
    { type: "text", label: "טלפון", required: true },
    { type: "text", label: "אימייל", required: false },
    { type: "file", label: "צילום תעודת זהות", help: "אפשר לצלם מהטלפון", required: true },
    { type: "long_text", label: "ספר בקצרה במה מדובר", required: true },
    { type: "yes_no", label: "האם יש הליך משפטי תלוי ועומד בעניין הזה?", required: true },
    {
      type: "text",
      label: "באיזה בית משפט, ומה מספר התיק?",
      required: false,
      dependsOn: 8,
      dependsValue: "yes",
    },
    { type: "yes_no", label: "האם פנית לעורך דין אחר בעניין הזה?", required: true },
    {
      type: "text",
      label: "שם עורך הדין, והאם הייצוג הסתיים",
      help: "חשוב לדעת לפני שמתחילים",
      required: false,
      dependsOn: 10,
      dependsValue: "yes",
    },
    {
      type: "yes_no",
      label: "האם יש מועד קרוב שאנחנו צריכים לדעת עליו?",
      help: "דיון, מועד להגשה, תפוגת התיישנות",
      required: true,
    },
    { type: "date", label: "מתי?", required: false, dependsOn: 12, dependsValue: "yes" },
    {
      type: "file",
      label: "מסמכים רלוונטיים — חוזים, מכתבים, כל דבר שקיבלת",
      required: false,
    },
    {
      type: "consent",
      label: "אני מאשר/ת",
      body:
        "הפרטים שמסרתי נכונים ומלאים למיטב ידיעתי. ידוע לי שמסירת הפרטים אינה " +
        "יוצרת יחסי עורך דין–לקוח, ושייצוג ייקבע רק לאחר פגישה ובכפוף להסכם שכר " +
        "טרחה בכתב ולבדיקת ניגוד עניינים.",
      required: true,
    },
    { type: "signature", label: "חתימה", required: false },
  ],
};

export const TEMPLATES: Template[] = [APARTMENT_SALE, FIRST_MEETING];
