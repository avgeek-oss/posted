# Publish History and delivery details

One delivery set contains every numbered post and its selected accounts. A three-post sequence for two accounts has six deliveries. **Post in X accounts** opens a confirmation dialog, then the accepted request opens its details page. You can also open **Details** from **Publish History**, the first item under Posts.

The **Delivery set** Attributes card shows Requested and Scheduled for. The table below it shows each numbered post and account, content, status, published time and result. A successful provider URL opens the published post. Errors are scoped to their account.

| State      | Meaning                                                                  |
| ---------- | ------------------------------------------------------------------------ |
| Scheduled  | Waiting for its scheduled time and an available worker.                  |
| Preparing  | A worker is preparing media or provider-side upload containers.          |
| Publishing | The worker crossed the public publishing boundary.                       |
| Published  | The provider returned a confirmed success.                               |
| Partial    | Some account deliveries succeeded and others did not.                    |
| Failed     | A definitive failure occurred without an unknown successful publication. |
| Uncertain  | Posted cannot establish whether the provider published the request.      |
| Cancelled  | Pending delivery was cancelled before publication.                       |

Successful deliveries stay recorded when another account fails. Posted does not blindly retry across an uncertain publishing boundary. Inspect the provider account and resolve the outcome before intentionally making a new request. A repeated request key is for replaying the same logical operation, not for asking the provider to publish again.

**Posted by** records the person responsible for the last accepted change. Background worker completion does not change attribution. Older edited data whose editor was never recorded displays **Not recorded** until a successful save.

For linked sequences, a later post waits for the previous confirmed result on that account. X, Bluesky and Threads link replies to the prior post; LinkedIn publishes separate posts in order. An earlier failure or uncertain result prevents later posts for that account from being sent, while other accounts can still complete.
