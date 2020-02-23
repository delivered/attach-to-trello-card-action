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
    core.debug(res.data);
    return res.data;
  } catch(err) {
    core.error(`${verb} to ${url} errored: ${err}`);
    if(err.response) {
      core.error(err.response.data);
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


const extractTrelloCardId = (prBody) =>   {
  core.debug(`pr body: ${prBody}`);  
  
  //find 1st instance of trello card url - must be 1st thing in PR
  const matches = /^\s*https\:\/\/trello\.com\/c\/(\w+)/.exec(prBody);
  const cardId = matches && matches[1];
  core.debug(`card id = ${cardId}`);

  return cardId;
}

const commentsContainsTrelloLink = async (cardId) => {
  const linkRegex = new RegExp(`\\[[^\\]]+\\]\\(https:\\/\\/trello.com\\/c\\/${cardId}\\/[^)]+\\)`);

  const comments = await getPrComments();  
  return comments.data.some((comment) => linkRegex.test(comment.body));
};

const buildTrelloLinkComment = async (cardId) => {
  const cardInfo = await getCardInfoSubset(cardId);
  return `![](https://github.trello.services/images/mini-trello-icon.png) [${cardInfo.name}](${cardInfo.url})`;
}


(async () => {
  try {
      console.log('------1')
    console.log(github);
    console.log('------2')
    console.log(github.context);
        console.log('------3')
    console.log(evthookPayload);
    if(!(evthookPayload.eventName === supportedEvent && supportedActions.some(el => el === evthookPayload.action))) {
       core.info(`event/type not supported: ${evthookPayload.eventName}.${evthookPayload.action}.  skipping action.`);
       return;
    }
    
    const cardId = extractTrelloCardId(evthookPayload.pull_request.body);
    const prUrl = evthookPayload.pull_request.html_url;
  
    if(cardId) {
      let extantAttachments;
      
      core.debug(`card url for ${cardId} specified in pr comment.`);
      extantAttachments = await getCardAttachments(cardId);

      //make sure not already attached
      if(extantAttachments == null || !extantAttachments.some(it => it.url === prUrl)) {
        const createdAttachment = await createCardAttachment(cardId, prUrl);
        core.info(`created trello attachment.`);
        core.debug(createdAttachment);
        
        // BRH NOTE actually, the power-up doesn't check if it previously added comment, so check is maybe superfluous
        if(shouldAddPrComment && !await commentsContainsTrelloLink(cardId)) {
          core.debug('adding pr comment');
          const newComment = await buildTrelloLinkComment(cardId)

                    //comments as 'github actions' bot, at least when using token automatically generated for GH workflows
          await addPrComment(newComment);
        } else {
          core.info('pr comment present or unwanted - skipped add.');
        }
      } else {
        core.info('trello attachement already exists - skipped create.');
      }
    } else {
      core.info(`no card url in pr comment. nothing to do.`);
    }
  } catch (error) {
    core.error(error);
    //failure will stop PR from being mergeable if that setting enabled on the repo.  there is not currently a neutral exit in actions v2.
    core.setFailed(error.message);
  }
})();