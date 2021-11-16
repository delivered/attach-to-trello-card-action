const util = require('util');
const core = require('@actions/core');
const github = require('@actions/github');
const axios = require('axios');

const supportedEvent = 'pull_request';
const supportedActions = ['opened', 'reopened', 'edited'];

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
  } catch(err) {
    core.error(`${verb} to ${url} errored: ${err}`);
    if(err.response) {
      core.error(util.inspect(err.response.data));
    }
    throw err;  
  }
};

const getCardAttachments = async (cardId) => {
  return requestTrello('get', `/1/cards/${cardId}/attachments`);
};

const createCardAttachment = async (cardId, attachUrl) => {
  return requestTrello('post', `/1/cards/${cardId}/attachments`, {url: attachUrl});
};

const getCardInfoSubset = async (cardId) => {
  return requestTrello('get', `/1/cards/${cardId}`, null, {fields: 'name,url'});
};


const octokit = new github.GitHub(ghToken);

const baseIssuesArgs = {
    owner: (evthookPayload.organization || evthookPayload.repository.owner).login,
    repo: evthookPayload.repository.name,
    issue_number: evthookPayload.pull_request.number
};

const getPrComments = async () => {
  return octokit.issues.listComments(baseIssuesArgs);
};

const addPrComment = async (body) => {
  return octokit.issues.createComment({
      ...baseIssuesArgs,
      body
  });
};


// to stop looking when we get to what looks like pr description, use stopOnNonLink true.  to allow interspersed lines of
// yada yada yada b/w Trello links, use false.
const extractTrelloCardIds = (prBody, stopOnNonLink = true) =>   {
  core.debug(`prBody: ${util.inspect(prBody)}`);
  
  // browsers submit textareas with \r\n line breaks on all platforms
  const browserEol = '\r\n';
  // requires that link be alone own line, and allows leading/trailing whitespace
  const linkRegex = /^\s*(https\:\/\/trello\.com\/c\/(\w+)(\/\S*)?)?\s*$/;
  
  const cardIds = [];
  const lines = prBody.split(browserEol);
  if(!prBody || prBody==="") {
    return cardIds;
  }
  //loop and gather up cardIds, skipping blank lines. stopOnNonLink == true will bust out when we're out of link-only territory.
  for(const line of lines) {
    const matches = linkRegex.exec(line);
    if(matches) {
      if(matches[2]) {
        core.debug(`found id ${matches[2]}`);
        cardIds.push(matches[2]);
      }
    } else if(stopOnNonLink) {
      core.debug('matched something non-blank/link.  stopping search');
      break;
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


(async () => {
  try {
    if(!(github.context.eventName === supportedEvent && supportedActions.some(el => el === evthookPayload.action))) {
       core.info(`event/type not supported: ${github.context.eventName.eventName}.${evthookPayload.action}.  skipping action.`);
       return;
    }
    
    const prUrl = evthookPayload.pull_request.html_url;
    const cardIds = extractTrelloCardIds(evthookPayload.pull_request.body);
  
    if(cardIds && cardIds.length > 0) {
      for(const cardId of cardIds) {   
        let extantAttachments;
      
        core.info(`card url for ${cardId} specified in pr.`);
        extantAttachments = await getCardAttachments(cardId);

        //make sure not already attached
        if(extantAttachments == null || !extantAttachments.some(it => it.url === prUrl)) {
          const createdAttachment = await createCardAttachment(cardId, prUrl);
          core.info(`created trello attachment for card ${cardId}.`);
          core.debug(util.inspect(createdAttachment));
        
          // BRH NOTE actually, the power-up doesn't check if it previously added comment, so this doesn't exactly match
          //  its fxnality.
          if(shouldAddPrComment && !await commentsContainsTrelloLink(cardId)) {
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
      core.info(`no card urls in pr comment. nothing to do.`);
    }
  } catch (error) {
    core.error(util.inspect(error));
    //failure will stop PR from being mergeable if that setting enabled on the repo.  there is not currently a neutral exit in actions v2.
    core.setFailed(error.message);
  }
})();
