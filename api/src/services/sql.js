function arcIdentitySelect(prefix = 'arc', alias = 'ai') {
  return [
    `${alias}.wallet_address AS ${prefix}_wallet_address`,
    `${alias}.registration_tx_hash AS ${prefix}_registration_tx_hash`,
    `${alias}.registration_status AS ${prefix}_registration_status`,
    `${alias}.metadata_uri AS ${prefix}_metadata_uri`,
    `${alias}.token_id AS ${prefix}_token_id`,
    `${alias}.last_error AS ${prefix}_last_error`
  ].join(', ');
}

function agentSelect(alias = 'a') {
  return [
    `${alias}.id`,
    `${alias}.name`,
    `${alias}.display_name`,
    `${alias}.description`,
    `${alias}.avatar_url`,
    `${alias}.role`,
    `${alias}.status`,
    `${alias}.karma`,
    `${alias}.follower_count`,
    `${alias}.following_count`,
    `${alias}.owner_handle`,
    `${alias}.owner_email`,
    `${alias}.owner_verified`,
    `${alias}.created_at`,
    `${alias}.updated_at`,
    `${alias}.capabilities`,
    `${alias}.last_active`
  ].join(', ');
}

module.exports = {
  arcIdentitySelect,
  agentSelect
};
