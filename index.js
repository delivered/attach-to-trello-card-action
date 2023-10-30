const util = require('util');
const core = require('@actions/core');
const github = require('@actions/github');
const axios = require('axios');

const supportedEvent = 'pull_request';
const supportedActions = ['opened', 'reopened', 'edited','labeled'];

//configured in workflow file, which in turn should use repo secrets settings
const trelloKey = core.getInput('trello-key', { required: true });
const trelloToken = core.getInput('trello-token', { required: true });
//adds extra (redundant) PR comment, to mimic normal behavior of trello GH powerup
const shouldAddPrComment = core.getInput('add-pr-comment') === 'true';
//token is NOT magically present in context as some docs seem to indicate - have to supply in workflow yaml to input var
const ghToken = core.getInput('repo-token');

const evthookPayload = github.context.payload;

const trelloClient = axios.create({
  baseURL: 'https://api.trello.com',
});

const requestTrello = async (verb, url, body = null, extraParams = null) => {
  try {
    const params = {
      ...(extraParams || {}),
      key: trelloKey,
      token: trelloToken
    };

    const res = await trelloClient.request({
      method: verb,
      url: url,
      data: body || {},
      params: params
    });
    core.debug(`${verb} to ${url} completed with status: ${res.status}.  data follows:`);
    //BRH NOTE core.xxx logging methods explode with typeerror when given non-string object.  TODO wrap.
    core.debug(util.inspect(res.data));
    return res.data;
  } catch (err) {
    core.error(`${verb} to ${url} errored: ${err}`);
    if (err.response) {
      core.error(util.inspect(err.response.data));
    }
    throw err;
  }
};

const getCardAttachments = async (cardId) => {
  return requestTrello('get', `/1/cards/${cardId}/attachments`);
};

const createCardAttachment = async (cardId, attachUrl) => {
  return requestTrello('post', `/1/cards/${cardId}/attachments`, { url: attachUrl });
};

const getCardInfoSubset = async (cardId) => {
  return requestTrello('get', `/1/cards/${cardId}`, null, { fields: 'name,url' });
};

if (ghToken) {
  const octokit = new github.getOctokit(ghToken);
}

const baseIssuesArgs = {
  owner: (evthookPayload.organization || evthookPayload.repository.owner).login,
  repo: evthookPayload.repository.name,
  issue_number: evthookPayload.pull_request.number
};

const getPrComments = async () => {
  if (!octokit) {
    throw new Error('Could not get PR comments. Is the GH repo-token provided?');
  }
  return octokit.rest.issues.listComments(baseIssuesArgs);
};

const addPrComment = async (body) => {
  if (!octokit) {
    throw new Error('Could not get PR comments. Is the GH repo-token provided?');
  }
  return octokit.rest.issues.createComment({
    ...baseIssuesArgs,
    body
  });
};


// to stop looking when we get to what looks like pr description, use stopOnNonLink true.  to allow interspersed lines of
// yada yada yada b/w Trello links, use false.
const extractTrelloCardIds = (prBody) => {
  core.debug(`prBody: ${util.inspect(prBody)}`);

  if (!prBody || prBody === '') {
    return cardIds;
  }

  // browsers submit textareas with \r\n line breaks on all platforms
  const browserEol = '\r\n';
  const linkRegex = /(https\:\/\/trello\.com\/c\/(\w+)(\/\S*)?)/;

  const cardIds = [];
  const lines = prBody.split(browserEol);

  //loop and gather up cardIds
  for (const line of lines) {
    const matches = linkRegex.exec(line);
    if (matches) {
      if (matches[2]) {
        core.debug(`found id ${matches[2]}`);
        cardIds.push(matches[2]);
      }
    }
  };
  return cardIds;
}

const commentsContainsTrelloLink = async (cardId) => {
  const linkRegex = new RegExp(`\\[[^\\]]+\\]\\(https:\\/\\/trello.com\\/c\\/${cardId}(\\/[^)]*)?\\)`);

  const comments = await getPrComments();
  return comments.data.some((comment) => linkRegex.test(comment.body));
};

const buildTrelloLinkComment = async (cardId) => {
  const cardInfo = await getCardInfoSubset(cardId);
  return `![](https://github.trello.services/images/mini-trello-icon.png) [${cardInfo.name}](${cardInfo.url})`;
}


// Run everytime new commit is pushed 
(async () => {
  try {

    core.info("hello this is new code from den");

    if (!(github.context.eventName === supportedEvent && supportedActions.some(el => el === evthookPayload.action))) {
      core.info(`event/type not supported: ${github.context.eventName.eventName}.${evthookPayload.action}.  skipping action.`);
      return;
    }

   

    const labels = evthookPayload.pull_request.labels
    core.info("printing labels ...");
    core.info(evthookPayload.pull_request.labels);

    const hasReadyLabel =  labels.some(it => it == "ready for review");

    if(!hasReadyLabel){
      return;
    }

    const prUrl = evthookPayload.pull_request.html_url;
    const cardIds = extractTrelloCardIds(evthookPayload.pull_request.body);


 

    if (cardIds && cardIds.length > 0 && hasReadyLabel) { // check if label is ready for review as well

      for (const cardId of cardIds) {
        let extantAttachments;

        core.info(`card url for ${cardId} specified in pr.`);
        extantAttachments = await getCardAttachments(cardId);

        //make sure not already attached
        if (extantAttachments == null || !extantAttachments.some(it => it.url === prUrl)) {
          const createdAttachment = await createCardAttachment(cardId, prUrl);
          core.info(`created trello attachment for card ${cardId}.`);
          core.debug(util.inspect(createdAttachment));

          // BRH NOTE actually, the power-up doesn't check if it previously added comment, so this doesn't exactly match
          //  its fxnality.
          if (shouldAddPrComment && !await commentsContainsTrelloLink(cardId)) {
            core.debug(`adding pr comment for card ${cardId}.`);
            const newComment = await buildTrelloLinkComment(cardId)

            //comments as 'github actions' bot, at least when using token automatically generated for GH workflows
            await addPrComment(newComment);
          } else {
            core.info(`pr comment already present or unwanted for card ${cardId} - skipped comment add.`);
          }
        } else {
          core.info(`trello attachment for card ${cardId} already exists - skipped attachment create.`);
        }
      };
    } else {
      
      throw new Error("no card urls in pr comment,please attach your card to this pull request.")
      //core.info(`no card urls in pr comment. nothing to do.`);
    }
  } catch (error) {
    core.error(util.inspect(error));
    //failure will stop PR from being mergeable if that setting enabled on the repo.  there is not currently a neutral exit in actions v2.
    core.setFailed(error.message);

  }
})();
