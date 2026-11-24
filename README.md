# QuizDesk — GitHub Pages + Supabase (v2)

QuizDesk is a static, responsive multiple-choice quiz application. The website is plain HTML, CSS and JavaScript and can be hosted on **GitHub Pages**. Supabase provides the shared PostgreSQL database, teacher authentication and question-image storage.

## What's new in v2

- **Edit existing quizzes:** use the Edit button beside any quiz in the teacher dashboard.
- **Reorder questions:** move questions up or down while creating or editing. The saved order is the displayed order for students.
- **Add question images:** upload JPG, PNG, WEBP or GIF images (up to 5 MB). The image appears above the question text. Text-only questions have no image placeholder. Image-only questions are supported too.
- **Submission history is preserved:** every edit creates a new immutable quiz revision. Attempts already started/submitted remain attached to the earlier revision, including its original question wording, image, options and answer key.
- **Formatting is preserved:** line breaks and repeated spaces in question and option text are retained.

## Architecture

- GitHub Pages serves `index.html`, `styles.css`, `app.js` and `config.js`.
- Supabase Auth handles teacher login.
- Supabase PostgreSQL stores quizzes, question revisions, private answer keys, student attempts and results.
- Supabase Storage stores uploaded question images in a public bucket. Images are intended to be part of assessments visible to students, so their public URLs can be loaded by the student page. Only authenticated teacher accounts can upload, update or delete files through the Storage API.

GitHub Pages alone cannot securely store shared quiz data or run a backend. The Supabase project is required for multiple students/devices to share quiz data.

## Project files

```text
quizdesk/
├── index.html                 # Website structure and student/teacher views
├── styles.css                 # Responsive styling
├── app.js                     # Browser logic, quiz editing, image upload and Supabase calls
├── config.js                  # Supabase URL + public publishable/anon key
├── supabase-schema.sql        # Complete schema for a new installation (v1 + v2)
├── supabase-migration-v2.sql  # Upgrade an existing v1 QuizDesk database to v2
├── .nojekyll                  # Prevents GitHub Pages/Jekyll processing
├── .gitignore
└── README.md
```

## Setup and deployment

### A. Create a Supabase project

1. Open [Supabase](https://supabase.com/) and create a project.
2. Save the database password securely.
3. In **Project Settings → API** (dashboard labels may change), copy the **Project URL** and the **publishable key** (`sb_publishable_...`) or legacy public `anon` key.
4. Do not use a `service_role` key, secret key or database password in browser JavaScript.

### B. Set up the database

**For a brand-new QuizDesk database:**

1. Open Supabase **SQL Editor → New query**.
2. Copy the entire contents of `supabase-schema.sql` into the editor.
3. Run it and check that the query completes without errors.

**For an existing QuizDesk v1 database (the earlier GitHub Pages version):**

1. Make a database backup first.
2. Open Supabase **SQL Editor → New query**.
3. Copy the entire contents of `supabase-migration-v2.sql` into the editor.
4. Run it once and check that it completes without errors.
5. Do not run the v1 schema file again after migration. The migration adds revision tracking, image support, storage setup, updated RPC functions and policies without deleting previous submissions.

The SQL migration creates the `quiz-question-images` public Storage bucket and teacher-only upload/update/delete policies automatically. No separate manual bucket creation is required.

### C. Create your teacher account

There is no public teacher-registration page. The project owner creates teacher accounts:

1. In Supabase, open **Authentication → Users → Add user** and create an email/password account.
2. Open **SQL Editor** and run this query after replacing the email and name:

```sql
insert into public.teachers (user_id, display_name)
select id, 'Teacher Name'
from auth.users
where email = 'teacher@example.com'
on conflict (user_id)
do update set display_name = excluded.display_name;
```

3. Check that one row was inserted/updated in `public.teachers`.
4. Sign in to QuizDesk using that email and password.

### D. Connect the website

Edit `config.js` and replace the placeholders:

```js
window.QUIZDESK_CONFIG = {
  SUPABASE_URL: "https://YOUR-PROJECT-REF.supabase.co",
  SUPABASE_ANON_KEY: "YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY"
};
```

Use your actual Project URL and browser-safe publishable/anon key. It is expected that this key is visible in the site's source. The database is protected by Row Level Security policies. Never put a service-role/secret key in this file.

### E. Test locally (optional)

No Python, Flask, Node.js, npm or build process is required. You can run a local static server using Python if available:

```bash
python -m http.server 8000
```

Then visit `http://localhost:8000/`. Confirm that the site says **Connected**, sign in as teacher and test creating/editing a quiz, reordering questions, uploading an image and submitting a student attempt.

### F. Upload to GitHub

1. Create a GitHub repository, such as `quizdesk`.
2. Upload all project files to the repository root. In particular, keep `index.html` at the root.
3. Commit to the `main` branch.

With Git:

```bash
git init
git add .
git commit -m "Add QuizDesk v2"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/quizdesk.git
git push -u origin main
```

Or upload the extracted files using GitHub's web interface.

### G. Enable GitHub Pages

1. Open repository **Settings → Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**.
3. Select branch `main` and folder `/ (root)`.
4. Click **Save**.
5. The public URL will look like:

```text
https://YOUR-USERNAME.github.io/quizdesk/
```

### H. Configure Supabase Auth URLs

In Supabase, open **Authentication → URL Configuration**:

- Set **Site URL** to your published GitHub Pages URL.
- Add the same address to the allowed **Redirect URLs** list.

The current email/password login does not depend on an OAuth redirect, but setting the site URL is recommended for Auth configuration and future account features.

## Using the v2 features

### Edit a quiz

1. Sign in to the teacher dashboard.
2. Find the quiz and click **Edit**.
3. Change the title, description, publication status, questions, options, answer key or images.
4. Save changes. The application creates a new revision; previous attempts are not altered.

### Reorder questions

Use the up-arrow and down-arrow controls in each question editor. The top question cannot move further up, and the bottom question cannot move further down. The order shown in the editor is the order students receive after saving.

### Add a question image

1. In a question editor, select an image file under **Question image**.
2. Wait for the upload-complete message before saving.
3. The preview appears in the teacher editor.
4. If question text is also entered, students see the image first and the text underneath it. If no image is selected, no image placeholder is displayed. A question may also contain an image without text.
5. Select **Remove image** to remove it from the question, then save the quiz.

Images are uploaded to the Supabase `quiz-question-images` bucket. Previously used images are intentionally retained so that old submission revisions can still display their original images. If you repeatedly replace/remove images, unused files may remain in Storage and can be cleaned up manually only after confirming that no archived revision references them.

## Important operating notes

- Students are anonymous and enter their own name/student ID. This is convenient but does not independently verify student identity.
- Students may submit multiple attempts. Each attempt is stored separately.
- A question edit, image change, option change, answer-key change or reordering creates a new quiz revision. Attempts already started remain locked to the revision they began, and their old answer key remains available for teacher review.
- Do not manually delete old question rows or answer keys from Supabase; old revisions are needed to review previous attempts.
- Question images are publicly viewable through their image URLs because they are assessment content shown to students. Do not upload private or sensitive images.
- Student pages never receive answer keys or scores. The database grades submissions and only the teacher can access result data.
- Start timestamps and elapsed time are recorded/calculated by PostgreSQL.
- Automatic email, SMS and WhatsApp notifications are not included. The teacher can contact students using the details they provide.
- Before using this for real assessments, test with sample quizzes and review your Supabase backup, usage, privacy and access settings.

## Troubleshooting

**Question image upload fails**
- Confirm `supabase-migration-v2.sql` was run successfully.
- Confirm the signed-in user exists in `public.teachers`.
- Confirm the file is JPG, PNG, WEBP or GIF and is 5 MB or smaller.
- Confirm the Storage bucket `quiz-question-images` exists and the teacher upload policy is present.

**Edit quiz or save changes fails**
- Confirm the v2 migration has been run.
- Check that the logged-in teacher owns the quiz.
- Open the browser developer console and inspect the Supabase error message if needed.

**The student list does not show the latest question order/content**
- Save the edit, refresh the public quiz list and try again.
- Hard-refresh the page to clear cached JavaScript/CSS.

**Teacher login works but dashboard access is denied**
- Confirm the teacher auth user exists and its UUID is present in `public.teachers`.

**GitHub Pages shows an older version**
- Confirm the updated files were committed to `main`.
- Check the repository's Actions/Pages deployment status.
- Hard-refresh the browser or test in a private window.
