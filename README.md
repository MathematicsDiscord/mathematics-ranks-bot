# Mathematics Ranks Bot – An Integrated Discord Help & Ranking System

## Table of Contents
1. [Key Features](#key-features)
2. [Installation and Setup](#installation-and-setup)
3. [Environment Configuration](#environment-configuration)
4. [Creating the Discord Bot](#creating-the-discord-bot)
5. [Bot Commands](#bot-commands)

### Key Features

**🧠 Intelligent Help Channel Management:**

The bot facilitates a structured onboarding process for new contributors. When a user first attempts to post in a help thread, their message is preemptively removed, and they are privately sent the "Helper Guidelines". The "Volunteer Helper" role is granted only upon their agreement to these terms.
The system provides complete lifecycle management for help threads, which includes sending automated reminders for inactivity and executing automatic closure if the thread creator leaves the server or deletes their initial message.

**⭐ Progressive Ranking System:**

Members accrue points when they receive a "thank" from the user they have assisted at the time a thread is closed. The system features a configurable daily point cap to prevent helper burnout and automatically assigns role rewards based on reaching predefined point thresholds.
Once all standard volunteer ranks are achieved, a helper becomes eligible to apply for more prestigious roles (e.g., Verified Helper, Certified Helper) through an integrated application system. These applications are sent to a private staff-only channel for review, which includes an interface for accepting or declining and providing direct feedback. An accepted application unlocks further opportunities for rank progression.

**📊 Data Analytics & Leaderboards:**

The /tophelpers command presents a paginated leaderboard with all-time, monthly, and weekly statistical breakdowns. It also dynamically generates bar graphs to visualize top helpers' points and their activity across different help channels (e.g., School vs. University).

---

###  Installation and Setup

Before you can begin setting up the bot, you'll need to make sure you have the following:
1. Node.js (v16.9.0 or higher recommended)
2. Git
3. A MySQL database server.

First, you'll need to run the following commands:

```bash
git clone https://github.com/MathematicsDiscord/mathematics-ranks-bot.git
cd <the place where you cloned the git repo>
npm install
```

and then, we'll have to get the database for the bot set up and connected.

```sql
CREATE DATABASE ranking_bot;
```

> **Note:** if you don't have MySQL, follow this [video tutorial](https://www.youtube.com/watch?v=455KKhZyvow) to set it up.

### Environment Configuration

The next step is to create a new text document, make sure to name it ```.env```, and you can use the following template for its contents:

```env
#-- Discord Bot Credentials --#
TOKEN=YOUR_DISCORD_BOT_TOKEN
CLIENT_ID=YOUR_BOTS_CLIENT_ID
GUILD_ID=YOUR_SERVER_ID

#-- Database Connection --#
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_database_password
DB_NAME=ranking_bot

#-- Forum & Channel IDs --#
HELP_SCHOOL_FORUM_ID=ID_OF_THE_SCHOOL_HELP_FORUM
HELP_UNIVERSITY_FORUM_ID=ID_OF_THE_UNIVERSITY_HELP_FORUM
APPLICATION_CHANNEL_ID=ID_OF_THE_CHANNEL_FOR_VERIFICATION_APPS
RANKUP_LOGS_CHANNEL_ID=ID_OF_THE_CHANNEL_FOR_RANK_UP_LOGS
THANK_LOG_CHANNEL_ID=ID_OF_THE_CHANNEL_FOR_THANK_YOU_LOGS
ERROR_CHANNEL_ID=ID_OF_THE_CHANNEL_FOR_BOT_ERROR_LOGS

#-- Role IDs --#
VOLUNTEER_HELPER_ROLE_ID=ID_OF_THE_VOLUNTEER_HELPER_ROLE
STAFF_OR_ADMIN_ROLE_IDS=ROLE_ID_1,ROLE_ID_2,ROLE_ID_3
RANK_1_ROLE_ID=ID_OF_RANK_1_ROLE
RANK_2_ROLE_ID=ID_OF_RANK_2_ROLE
RANK_3_ROLE_ID=ID_OF_RANK_3_ROLE
RANK_4_ROLE_ID=ID_OF_RANK_4_ROLE
RANK_5_ROLE_ID=ID_OF_RANK_5_ROLE
RANK_6_ROLE_ID=ID_OF_RANK_6_ROLE
RANK_7_ROLE_ID=ID_OF_THE_VERIFIED_HELPER_ROLE
RANK_8_ROLE_ID=ID_OF_RANK_8_ROLE
RANK_9_ROLE_ID=ID_OF_RANK_9_ROLE
RANK_10_ROLE_ID=ID_OF_RANK_10_ROLE
RANK_11_ROLE_ID=ID_OF_RANK_11_ROLE
RANK_12_ROLE_ID=ID_OF_RANK_12_ROLE
RANK_13_ROLE_ID=ID_OF_RANK_13_ROLE

#-- Emoji IDs --#
VERIFIED_EMOJI_ID=ID_OF_YOUR_VERIFIED_STATUS_EMOJI
UNVERIFIED_EMOJI_ID=ID_OF_YOUR_UNVERIFIED_STATUS_EMOJI
HELPER_POINTS_EMOJI_ID=ID_OF_YOUR_HELPER_POINTS_EMOJI

#-- Error Logging --#
ERROR_WEBHOOK_URL=YOUR_DISCORD_WEBHOOK_URL_FOR_FATAL_ERRORS
```
> **Note:** Please complete the configuration of your `.env` file before proceeding to the next step.

### Creating the Discord Bot

1. Navigate to the [Discord Developer portal](https://discord.com/developers/applications) in your web browser.
2. Log in with your Discord account.
3. Click the "New Application" button in the top-right corner.
4. Give your application a name. This will be the initial name of the bot. For example: Mathematics Rank Bot.
5. Agree to the Discord Developer Terms of Service and click "Create".
6. Find the "Application ID". This is a long number.
7. Click the "Copy" button next to it.
8. Paste this value into your .env file for the CLIENT_ID variable.

```env
CLIENT_ID=YOUR_APPLICATION_ID_HERE
```

9. In the navigation menu on the left, click on the "Bot" tab.
10. You will see your bot's username and icon.
11. Find the section titled "Token" and click the "Reset Token" button.
12. Confirm by clicking "Yes, do it!".
13. Click the "Copy" button to copy the token to your clipboard, and immediately paste this value into your .env file for the TOKEN variable.

```env
TOKEN=YOUR_SECRET_BOT_TOKEN_HERE
```

14. On the "Bot" page, scroll down to the "Privileged Gateway Intents" section.
You must enable the following three intents:
✅ SERVER MEMBERS INTENT
✅ MESSAGE CONTENT INTENT
15. In the navigation menu, go to the "OAuth2" tab, and then click on the "URL Generator" sub-tab.
In the "Scopes" box, select the following:
✅ bot
✅ applications.commands
16. A new "Bot Permissions" box will appear below. For this bot to function correctly, it needs a wide range of permissions to manage roles, channels, messages, and threads.
For the simplest setup, select "Administrator". This grants the bot all necessary permissions.
(For advanced users: If you prefer not to grant Administrator, you must manually select all permissions related to managing channels, managing threads, sending messages, managing roles, and reading message history.)
17. A generated URL will appear at the bottom of the page. Click the "Copy" button.
Paste this URL into your browser, select the server you want to add the bot to from the dropdown menu, and click "Authorize".
18. To get the bot running, just type:
```bash
node index.js
```
Or
```bash
nohup node index.js &
```
---
### Bot Commands
| Command | Description | Options | Permissions |
| :--- | :--- | :--- | :--- |
| `/checkpoints [user]` | Checks the points and current rank of a user. If no user is specified, it checks your own points. | `user` (Optional): The user to check. Omitting this targets yourself. | Everyone (for checking self). Staff/Admin (for checking others). |
| `/tophelpers` | Displays an interactive, paginated leaderboard of the top helpers. Allows filtering by all-time, monthly, and weekly stats. Includes buttons to generate graphs for points and channel activity. | None | Everyone |
| `/givepoints <user> <points>` | Manually adds a specified number of points to a user. This can trigger a rank-up and will notify the target user via DM. | `user` (Required): The user to receive points.<br>`points` (Required): The amount of points to give. | Manager/Administrator |
| `/removepoints <user> <points>` | Manually removes a specified number of points from a user. This can trigger a de-rank and remove roles. The target user is notified via DM. | `user` (Required): The user to remove points from.<br>`points` (Required): The amount of points to remove. | Manager/Administrator |
| `/ping` | Checks the bot's current latency and API response time. Useful for diagnosing connection issues. | None | Administrator |
