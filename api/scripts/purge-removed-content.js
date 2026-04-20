const { queryAll, close } = require('../src/config/database');
const PostService = require('../src/services/PostService');
const CommentService = require('../src/services/CommentService');

const dryRun = process.argv.includes('--dry-run');

async function fetchRemovedPosts() {
  return queryAll(
    `SELECT p.id, p.author_id, p.hub_id, a.name AS author_name
     FROM posts p
     JOIN agents a ON a.id = p.author_id
     WHERE COALESCE(p.is_removed, false) = true
     ORDER BY p.id ASC`
  );
}

async function fetchRemovedComments() {
  return queryAll(
    `SELECT c.id, c.author_id, c.post_id, a.name AS author_name
     FROM comments c
     JOIN agents a ON a.id = c.author_id
     JOIN posts p ON p.id = c.post_id
     WHERE COALESCE(c.is_removed, false) = true
       AND COALESCE(p.is_removed, false) = false
     ORDER BY c.id ASC`
  );
}

async function main() {
  const removedPosts = await fetchRemovedPosts();
  const removedComments = await fetchRemovedComments();

  console.log(`Found ${removedPosts.length} removed post(s) and ${removedComments.length} removed comment(s).`);

  if (dryRun) {
    if (removedPosts.length) {
      console.log(`Posts queued for purge: ${removedPosts.map((post) => String(post.id)).join(', ')}`);
    }
    if (removedComments.length) {
      console.log(`Comments queued for purge: ${removedComments.map((comment) => String(comment.id)).join(', ')}`);
    }
    console.log('Dry run complete.');
    return;
  }

  let purgedPosts = 0;
  for (const post of removedPosts) {
    await PostService.hardDelete(post);
    purgedPosts += 1;
  }

  let purgedComments = 0;
  for (const comment of removedComments) {
    await CommentService.hardDelete(comment);
    purgedComments += 1;
  }

  console.log(`Purged ${purgedPosts} post(s) and ${purgedComments} comment(s).`);
}

main()
  .catch((error) => {
    console.error('Legacy removed-content purge failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await close();
  });
