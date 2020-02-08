const core = require('@actions/core');
const github = require('@actions/github');
const axios = require('axios');

//configured in workflow file, which in turn should use repo secrets settings
const trelloKey = core.getInput('trello-key');
const trelloToken = core.getInput('trello-token');
//adds extra (redundant) PR comment, to mimic normal behavior of trello GH powerup
const shouldAddPrComment = core.getInput('add-pr-comment') === 'true';
const ghToken = core.getInput('repo-token');


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
    console.log(`${verb} to ${url} completed with status: ${res.status}.  data follows:`);
    console.dir(res.data);
    return res.data;
  } catch(err) {
    console.log(`${verb} to ${url} errored: ${err}`);
    if(err.response) {
      //console.log(`status: ${err.status}.  error data follows:`);
      console.dir(err.response.data);
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

const extractTrelloCardId = (prBody) =>   {
  console.log(`pr body: ${prBody}`);  
  
  //find 1st instance of trello card url - must be 1st thing in PR
  const matches = /^\s*https\:\/\/trello\.com\/c\/(\w+)/.exec(prBody);
  const cardId = matches && matches[1];
  console.log(`card id = ${cardId}`);

  return cardId;
}


const getPrComments = async () => {
  //token is not magically present in context
  const octokit = new github.GitHub(ghToken);
  const evthookPayload = github.context.payload;
  
  return await octokit.issues.listComments({
      owner: (evthookPayload.organization || evthookPayload.repository.owner).login,
      repo: evthookPayload.repository.name,
      issue_number: evthookPayload.pull_request.number
  });
};

const addPrComment = async (body) => {
  const octokit = new github.GitHub(ghToken);
  const evthookPayload = github.context.payload;
  
  return await octokit.issues.createComment({
      owner: (evthookPayload.organization || evthookPayload.repository.owner).login,
      repo: evthookPayload.repository.name,
      issue_number: evthookPayload.pull_request.number,
      body
  });
}; 

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
    const cardId = extractTrelloCardId(github.context.payload.pull_request.body);
    const prUrl = github.context.payload.pull_request.html_url;
  
    if(cardId) {
      let extantAttachments;
      
      console.log(`card url for ${cardId} specified in pr comment.`);
      extantAttachments = await getCardAttachments(cardId);

      //make sure not already attached
      if(extantAttachments == null || !extantAttachments.some(it => it.url === prUrl)) {
        const createdAttachment = await createCardAttachment(cardId, prUrl);
        console.log(`created trello attachment: ${JSON.stringify(createdAttachment)}`);
        
        // BRH NOTE actually, the power-up doesn't check if it previously added comment, so check is maybe superfluous
        if(shouldAddPrComment && !await commentsContainsTrelloLink(cardId)) {
          console.log('adding pr comment');
          const newComment = await buildTrelloLinkComment(cardId)

          //comments as 'github actions' bot, at least when using token automatically generated for GH workflows
          addPrComment(newComment);
        } else {
          console.log('pr comment present or unwanted - skipping add');
        }
      } else {
        console.log('trello attachement already exists. skipped create.');
      }
    } else {
      console.log(`no card url in pr comment. nothing to do`);
    }
  } catch (error) {
    //failure will stop PR from being mergeable if that setting enabled on the repo.  there is not currently a neutral exit in actions v2.
    core.setFailed(error.message);
  }
})();