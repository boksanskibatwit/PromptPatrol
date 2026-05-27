# GitHub Workflow

## Branches

| Branch | Purpose |
|---|---|
| `main` | Completed code |
| `develop` | Active development |
| `lastname/feature` | Your personal feature branch |

Always branch off `develop`. Never commit directly to `main`.

## Day-to-day workflow

**1. Before you start working, pull the latest changes**

git checkout develop
git pull origin develop


**2. Create your feature branch**

git checkout -b lastname/what-youre-building


**3. Commit as you go**

git add .
git commit -m "short description of what you did"

**4. Push your branch to GitHub**

git push -u origin lastname/what-youre-building


**5. Open a pull request on GitHub**
- Go to the repo on GitHub
- Click "Compare & pull request"
- Set the base branch to `develop` (not `main`)
- Write a short description of what you built
- Merge it yourself when ready

**6. After merging, delete your feature branch**
GitHub will offer to delete it after merging — go ahead and do that to keep things tidy.

**7. Pull the latest develop on your machine**

git checkout develop
git pull origin develop


## If you get a merge conflict

VS Code will highlight the conflicts inline. Resolve them, then:

git add .
git commit -m "resolve merge conflict"
git push


## Quick reference

git status               # see what files you've changed
git pull origin develop  # get latest changes from the group
git log --oneline        # see recent commits
