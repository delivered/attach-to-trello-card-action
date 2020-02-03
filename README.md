# Attach to Trello Card action

This action looks for a Trello card URL in the start of a Pull Request description.  If found, will push an attachment to Trello (for use by Trello Github Power-Up).

This requires Trello key+token to be supplied from workflow where used (minimally, the token should come from repo Secrets).  See action.yml for specific inputs/outputs.