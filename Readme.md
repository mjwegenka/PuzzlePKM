Create a plan for the development of an Electron app that integrates with Dropbox for file storage and allows the user to create various types of editable notes and other objects.

Plan stages for the development of this app.

Generate a Markdown file with important questions that need to be answered before implementation can begin.

Object Types:

1. Topic Notes: These are notes that have tags and can be linked to from Daily Notes and other Topic Notes. They may also contain links to Reference Materials, Habits, or Projects.
2. Daily Notes: These are notes that are tied to a unique calendar day, and only one note can have a particular calendar day. They can also have tags. They may contain links to Topic Notes, Reference Materials, Habits, or Projects.
3. Projects: These are synced Dropbox directories that can be browsed within the app. The app should open files stored in these directories in the default app (ie. Microsoft Word or PDFExpert). Unlike reference materials, Projects often (but not always) have a start date and end date that corresponds to when the project took place. The start date and end date are optional. These can be tagged.
4. Reference Materials: These are synced Dropbox directories that can be browsed within the app. Each directory contains a single Reference Material object, but it may exist within several different versions within that directory. These can be tagged.
5. Habits: These are lightweight objects that have a tag and a less than 256 character piece of text associated with them. They always have a single date as a date object.
6. Tags: These group various objects together.

I should be able to edit Topic Notes and Daily Notes in the app using a Notion-like Tip Tap interface.