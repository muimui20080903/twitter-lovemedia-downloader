const screenName = "elonmusk";




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

