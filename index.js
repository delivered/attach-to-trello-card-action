const util = require('util');
const core = require('@actions/core');
const github = require('@actions/github');
const axios = require('axios');

const supportedEvent = 'pull_request';
const supportedActions = ['opened', 'reopened', 'edited', 'labeled', 'unlabeled'];
const trelloReviewLabelId = '64fa916ea60ef5c4ba86301a'

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
const getCard = async (cardId) => {
  return requestTrello('get', `/1/cards/${cardId}`);
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

const getTrelloCardLabels = async (cardId) => {
  return requestTrello('get', `/1/cards/${cardId}/idLabels`);
};

const addTrelloCardLabel = async (cardId, labelId) => {
  return requestTrello('post', `/1/cards/${cardId}/idLabels`, null, { value: labelId });
};


const removeTrelloCardLabel = async (cardId, labelId) => {
  return requestTrello('delete', `/1/cards/${cardId}/idLabels/${labelId}`);
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
};

const syncUpLabel = async (cardId, pullrequestHasReviewLabel) => {

  let trellolabels = await getTrelloCardLabels(cardId);
  core.info("syncup-label:Trell card's labels ="+JSON.stringify(trellolabels));
  var cardHasReviewLabel = trellolabels.some(lb => lb == trelloReviewLabelId);

  if (pullrequestHasReviewLabel && !cardHasReviewLabel) {

    await addTrelloCardLabel(cardId, trelloReviewLabelId);
    core.info(`syncup-label:add label [Ready for Team Review] to trello card`);
  }

  if (!pullrequestHasReviewLabel && cardHasReviewLabel) {
    await removeTrelloCardLabel(cardId, trelloReviewLabelId);
    core.info(`syncup-label:remove label [Ready for Team Review] from trello card`);
  }


};

const syncUpAttachment = async (cardId) => {
  let extantAttachments;
  extantAttachments = await getCardAttachments(cardId);
  //make sure not already attached
  if (extantAttachments == null || !extantAttachments.some(it => it.url === evthookPayload.pull_request.html_url)) {
    const createdAttachment = await createCardAttachment(cardId, evthookPayload.pull_request.html_url);
    core.info(`synup-attachment:created trello attachment for card ${cardId}.`);
    core.debug(util.inspect(createdAttachment));

    // BRH NOTE actually, the power-up doesn't check if it previously added comment, so this doesn't exactly match
    //  its fxnality.
    if (shouldAddPrComment && !await commentsContainsTrelloLink(cardId)) {
      core.debug(`synup-attachment:adding pr comment for card ${cardId}.`);
      const newComment = await buildTrelloLinkComment(cardId)

      //comments as 'github actions' bot, at least when using token automatically generated for GH workflows
      await addPrComment(newComment);
    } else {
      core.info(`synup-attachment:pr comment already present or unwanted for card ${cardId} - skipped adding comment .`);
    }
  } else {
    core.info(`synup-attachment:trello attachment for card ${cardId} already exists - skipped creating attachment .`);
  }
}

// Run everytime new commit is pushed 
(async () => {
  try {

 

    // 1. Check Github action event
    if (!(github.context.eventName === supportedEvent && supportedActions.some(el => el === evthookPayload.action))) {
      core.info(`event-check:event/type not supported: ${github.context.eventName.eventName}.${evthookPayload.action}.  skipping action.`);
      return;
    }
    core.info(`event-check:action == ${evthookPayload.action}, passed`);

    // 2. Check Trello card reference 
    // allow on pull request relates to only one cards
    // but a trello card can have many pull requests.

    const cardIds = extractTrelloCardIds(evthookPayload.pull_request.body);

    if (!cardIds || cardIds.length == 0) {
      throw new Error("trello-card-check:no card urls in pr comment,please attach your card to this pull request.")
    }

    if (cardIds.length != 1) {
      throw new Error("trello-card-check:can not have mulitple trello cards on one pull request.");
    }
    const cardId = cardIds[0];
    core.info(`trello-card-check:cardId = ${cardId}, passed`);

    // 3. Sync Up Attachment 
    await syncUpAttachment(cardId);

    // 4. Sync Up Label beteween pull request and trello card
    const labelObjects = evthookPayload.pull_request.labels
    const labels = labelObjects.map(function (object) {
      return object['name'];
    });
    core.info("syncup-label:Pull reqeust's labels:" + JSON.stringify(labels));
    const pullrequestHasReviewLabel = labels.some(label => label == "ready for review");
    await syncUpLabel(cardId, pullrequestHasReviewLabel);
    core.info("syncup-label:passed");


    // 5. if pull request has [ready for review] label , continue to check if card has verification step provided
    if (pullrequestHasReviewLabel) {
      var verificationTexReg = /verification.*step/;
      var cardObject = await getCard(cardId);
      var matches = verificationTexReg.exec(cardObject.desc.toLowerCase());
      if (!matches) {
        throw Error("verification-step-check:there is no verification steps on card yet , please just put \"Verification Steps\" as text or remove [ready for review] label to skip this error")
      }
      core.info("verification-step-check:passed");
    }

  } catch (error) {
    core.error(util.inspect(error));
    //failure will stop PR from being mergeable if that setting enabled on the repo.  there is not currently a neutral exit in actions v2.
    core.setFailed(error.message);

  }
})();
