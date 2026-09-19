# הגדרת Supabase לשמירת משתמשים באופן קבוע

השרת (Render, free tier) מאבד את כל הנתונים בזיכרון בכל פעם שהוא נרדם/מתאתחל.
כדי שמשתמשים רשומים לא ייעלמו, יש לחבר בסיס נתונים חיצוני חינמי — Supabase (Postgres).

## שלב 1 — יצירת פרויקט Supabase
1. היכנס ל-https://supabase.com והרשם/התחבר (חינמי).
2. צור פרויקט חדש (New project). בחר שם, סיסמה למסד הנתונים (שמור אותה), ואזור קרוב.
3. המתן שהפרויקט יעלה (כדקה-שתיים).

## שלב 2 — יצירת טבלת המשתמשים
1. בתפריט הצד: **SQL Editor** → **New query**.
2. הדבק את התוכן של הקובץ `server/supabase-schema.sql` (בתיקייה הזו) והרץ (Run).

## שלב 3 — איתור המפתחות
1. בתפריט הצד: **Project Settings** → **API**.
2. העתק:
   - **Project URL** (לדוגמה `https://xxxxx.supabase.co`)
   - **service_role key** (תחת "Project API keys" — **לא** ה-anon key! ה-service key עוקף RLS וצריך רק בשרת, לעולם לא בצד לקוח)

## שלב 4 — הגדרת משתני סביבה ב-Render
1. היכנס ל-https://dashboard.render.com → השירות `nextrade-lending` (או השם המתאים) → **Environment**.
2. הוסף שני משתנים חדשים:
   - `SUPABASE_URL` = ה-Project URL מהשלב הקודם
   - `SUPABASE_SERVICE_KEY` = ה-service_role key מהשלב הקודם
3. שמור — Render יבצע דיפלוי מחדש אוטומטית.

## שלב 5 — אימות
לאחר הדיפלוי, גש ל-`https://nextrade-lending.onrender.com/` — אמור להחזיר `"storage":"supabase"`.
אם המשתנים לא מוגדרים כראוי, השרת ימשיך לעבוד אך יחזיר `"storage":"in-memory"` ויאבד נתונים בכל הפעלה מחדש (כפי שקרה עד כה).

## הערה חשובה
לאחר החיבור, יש להירשם מחדש עם חשבון האדמין (ADMIN_USER/ADMIN_EMAIL/ADMIN_PASS מוגדרים כמשתני סביבה כבר קיימים ב-Render) — הזריעה (seeding) תתבצע אוטומטית בהפעלה הראשונה מול בסיס הנתונים החדש.
