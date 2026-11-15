# QuizDesk — GitHub Pages + Supabase

QuizDesk is a static, responsive multiple-choice quiz application. The website itself is plain HTML, CSS and JavaScript, so it can be hosted on **GitHub Pages**. Supabase provides the shared PostgreSQL database and teacher authentication.

> **Why Supabase is included:** GitHub Pages serves static files. It does not run a Python/Flask server or provide a shared database. The Supabase project stores quizzes, private answer keys, student attempts, answers and results. Students on different devices therefore see the same published quizzes.

## Features

### Student portal
- Browse published quizzes.
- Enter a name, student ID and optional email/phone contact.
- Answer multiple-choice questions.
- See selected answers but receive no correct/incorrect feedback or score.
- Submit once and receive a confirmation without a score.
- Have elapsed time calculated from a server-side start timestamp.

### Teacher portal
- Sign in using a Supabase Auth email/password account.
- Create quizzes with four options per question and choose the correct option.
- Save a quiz as a draft or publish it immediately.
- Publish/unpublish or delete quizzes. A quiz with student attempts cannot be deleted; unpublish it to preserve the submission history.
- Review submissions, student contact details, elapsed time, scores and each selected/correct answer.

### Data protection
- Correct answers are stored in a separate `answer_keys` table. Anonymous student access has no permission to read that table.
- Student answers and results are readable only by authenticated teachers who own the quiz.
- Students submit answers through a PostgreSQL function. The function grades the answers server-side and returns only `{ "submitted": true }`, not the score or answer key.
- Start time and elapsed time are recorded/calculated by PostgreSQL, not trusted from the student's browser.
- The browser uses only the Supabase publishable/anon key. Never put a Supabase `service_role` or secret key in website JavaScript.

## Files

```text
quizdesk-github/
├── index.html            # All page structure and views
├── styles.css            # Responsive site styling
├── app.js                # Browser logic and Supabase calls
├── config.js             # Supabase project URL + public key (edit this)
├── supabase-schema.sql   # Tables, access policies and database functions
├── .nojekyll             # Prevents GitHub Pages/Jekyll processing
├── .gitignore
└── README.md
```

## Setup guide

### 1. Create a Supabase project

1. Open [Supabase](https://supabase.com/) and sign in or create an account.
2. Create a new project and choose a strong database password. Save it securely.
3. When the project is ready, open **Project Settings → API** (the exact dashboard labels may change).
4. Copy the **Project URL**.
5. Copy the **publishable key** (`sb_publishable_...`) or the legacy `anon` public key. Both are intended for use in a browser with proper Row Level Security. **Do not copy the `service_role` or secret key.**

### 2. Create the database

1. In the Supabase project, open **SQL Editor**.
2. Choose **New query**.
3. Open the supplied `supabase-schema.sql` file, copy its entire contents and paste it into the SQL Editor.
4. Run the query. It creates the tables, indexes, Row Level Security policies and database functions used by the website.
5. Check the SQL Editor output for errors before continuing.

Run the schema in a new/empty QuizDesk database. Do not repeatedly run an edited schema against a live database without first making a backup and reviewing the changes.

### 3. Create your teacher login

Teacher accounts are created by the project owner; there is no public teacher-registration page.

1. In Supabase, open **Authentication → Users**.
2. Choose **Add user** and create the teacher account with your email and a strong password. Confirm/verify the account in the dashboard if prompted.
3. Open **SQL Editor** and run the following statement, replacing the email and display name with your own:

```sql
insert into public.teachers (user_id, display_name)
select id, 'Teacher Name'
from auth.users
where email = 'teacher@example.com'
on conflict (user_id)
do update set display_name = excluded.display_name;
```

4. Confirm that one row was inserted or updated in `public.teachers`.
5. Use this email and password on the QuizDesk Teacher sign-in screen.

If the insert affects zero rows, check that the Authentication user exists and that the email matches exactly.

### 4. Connect the website to Supabase

1. Open `config.js` in a text editor.
2. Replace the two placeholder values:

```js
window.QUIZDESK_CONFIG = {
  SUPABASE_URL: "https://YOUR-PROJECT-REF.supabase.co",
  SUPABASE_ANON_KEY: "YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY"
};
```

3. Save the file. For example:

```js
window.QUIZDESK_CONFIG = {
  SUPABASE_URL: "https://abcdefghijk.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_your_public_key_here"
};
```

The values above are examples only; use the real values from your own Supabase project.

The publishable/anon key is expected to be visible in browser source code. The database is protected by RLS policies in `supabase-schema.sql`. **Never put a `service_role`, secret or database password in `config.js`.**

### 5. Test locally (optional but recommended)

You do not need Python, Flask, npm or a build process. From the project directory, start any simple static file server. For example, if Python is installed:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000` in a browser. You can also open `index.html` directly, but a local server is a better test because it behaves more like the published site.

Check that:
- The connection indicator says **Connected**.
- The student page loads available quizzes (it will be empty until you publish one).
- Teacher sign-in accepts your teacher credentials.
- You can create and publish a sample quiz.
- A student can submit an attempt, but the student confirmation page does not show a score.
- The teacher dashboard shows the attempt, score, elapsed time and answer review.

### 6. Upload the project to GitHub

1. Sign in to [GitHub](https://github.com/).
2. Create a new repository, for example `quizdesk`.
3. Upload the project files to the **repository root**. At minimum, include:
   - `index.html`
   - `styles.css`
   - `app.js`
   - `config.js`
   - `.nojekyll`
   - `supabase-schema.sql`
   - `README.md`
   - `.gitignore`
4. Commit the files to the `main` branch.

You may upload through GitHub's website, or use Git from the project folder:

```bash
git init
git add .
git commit -m "Add QuizDesk static quiz application"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/quizdesk.git
git push -u origin main
```

Replace `YOUR-USERNAME` and `quizdesk` with your GitHub username and repository name.

### 7. Turn on GitHub Pages

1. Open your repository on GitHub.
2. Go to **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Select branch **main** and folder **/ (root)**.
5. Click **Save**.
6. Wait for the deployment status to complete. Your address will look similar to:

```text
https://YOUR-USERNAME.github.io/quizdesk/
```

Open the published address and confirm the connection indicator shows **Connected**. The root `index.html` file must remain at the repository root for this setup.

### 8. Add the GitHub Pages URL to Supabase Auth settings

In Supabase, open **Authentication → URL Configuration** (the menu name may be slightly different).

- Set **Site URL** to your published site URL, for example `https://YOUR-USERNAME.github.io/quizdesk/`.
- Add that same site URL to the allowed **Redirect URLs** list.

This is a good production configuration for the authentication site. The current email/password login does not use an OAuth redirect flow, but the Site URL is still useful for Auth configuration and future account features.

## How to use it

1. Sign in at your published site and click **Teacher access**.
2. Open **Create quiz**, enter the quiz title, add questions, fill all four options and select the correct answer.
3. Leave **Publish immediately** enabled to make the quiz visible to students. Turn it off to save a draft.
4. Share the published website URL with students.
5. Open **Recent submissions** in the teacher dashboard to review work. The review page shows the contact information students provided, their elapsed time, score and the correct answer for each question.

## Important limitations and operating notes

- **GitHub Pages is the website host; Supabase is the backend/database.** Both services are required for multiple students/devices to share quiz data. GitHub alone cannot securely provide the database or teacher login for this app.
- Student access is intentionally anonymous. A student enters a name and ID but does not have a personal login. This is convenient for classroom use, but the site does not independently verify a student's identity. A student could enter another person's details.
- Students can make more than one attempt. If you need one attempt per student, individual student accounts or a verified access code should be added in a later version.
- A started but abandoned attempt is not shown in the teacher's submitted-attempt list. The server start timestamp is retained, but no score is created until submission. Because attempts are retained, a quiz with an attempt cannot be deleted; unpublish it instead.
- The displayed timer is a browser display; the recorded elapsed time and score are calculated by the database. A browser tab being suspended may make the display tick less smoothly, but it does not reset the server start time.
- Students do not see instant correctness feedback or their score. The teacher dashboard is the only interface that reads scores and answer keys.
- Automatic email, SMS and WhatsApp notifications are not included. The teacher can use the contact information supplied by students to contact them separately.
- The website uses the Supabase JavaScript client and Google Fonts from public CDNs, so visitors need an internet connection.
- Before using the app for real assessments, test with a sample quiz and review your Supabase project's usage, backup and privacy settings. Do not collect unnecessary student personal information.

## Troubleshooting

**“Setup required” / “Could not connect”**
- Confirm `config.js` contains the correct Supabase Project URL and publishable/anon key.
- Confirm there are no missing quotes or commas in `config.js`.
- Confirm the Supabase project is running and the browser has internet access.

**The site loads but no quizzes appear**
- Sign in as teacher and check that the quiz is published.
- Confirm the quiz has at least one question.
- Check the Supabase SQL Editor output and table contents.

**Teacher login works but dashboard access is denied**
- Confirm the signed-in email exists in Supabase Authentication → Users.
- Confirm that user's UUID is present in `public.teachers`.
- Confirm the schema SQL was run successfully.

**Teacher can sign in but cannot see answer details**
- Confirm the quiz was created through this app and that it has answer-key rows in `public.answer_keys`.
- Confirm the logged-in user is the owner of the quiz.

**A recent edit does not appear on GitHub Pages**
- Confirm the modified files were committed and pushed to `main`.
- Check the repository's Actions tab and Pages deployment status.
- Try a hard refresh or a private browser window.
