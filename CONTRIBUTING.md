# Contributing to GamePlan / Jarvis AI

First off, thank you for considering contributing to GamePlan! It's people like you that make open-source software such a great community.

## Where do I go from here?

If you've noticed a bug or have a feature request, make sure to check our [Issues](https://github.com/battlesbudz/Gameplanjarvisai/issues) to see if someone else in the community has already created a ticket. If not, go ahead and make one!

## Fork & create a branch

If this is something you think you can fix, then fork GamePlan and create a branch with a descriptive name.

A good branch name would be (where issue #325 is the ticket you're working on):

```sh
git checkout -b 325-add-slack-integration
```

## Implement your fix or feature

At this point, you're ready to make your changes. Feel free to ask for help; everyone is a beginner at first!

## Make a Pull Request

At this point, you should switch back to your master branch and make sure it's up to date with GamePlan's master branch:

```sh
git remote add upstream https://github.com/battlesbudz/Gameplanjarvisai.git
git checkout master
git pull upstream master
```

Then update your feature branch from your local copy of master, and push it!

```sh
git checkout 325-add-slack-integration
git rebase master
git push --set-upstream origin 325-add-slack-integration
```

Finally, go to GitHub and make a Pull Request!
