// 引数で指定したscreenNameからuserIDを取得する
// 例: deno run --allow-net getUserIDByUserScreenName.ts elonmusk
const args = Deno.args;
const screenName = args[0] ?? "elonmusk";

import { TwitterOpenApi } from "npm:twitter-openapi-typescript";
const api = new TwitterOpenApi();
const client = await api.getGuestClient();
const response = await client.getUserApi().getUserByScreenName({ screenName: screenName });
const user = response.data.user
if (!user) throw new Error('user not found')
// const legacy = user.legacy
// console.log(legacy.screenName ?? 'undefined');
// console.log(`followedBy: ${legacy.followedBy} following: ${legacy.following}`);
// console.log('┄'.repeat(50));
console.log(
`screenName: ${user.legacy.screenName}
name: ${user.legacy.name}
id: ${user.restId}`)

