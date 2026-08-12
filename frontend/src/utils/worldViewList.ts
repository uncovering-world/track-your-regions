/**
 * The world views a re-placement failed for, named for the curator and numbered for
 * the admin they take it to.
 *
 * Its own module because two surfaces say this same sentence about the same payload
 * — the curator's own publish card and the admin panel's batch notice — and what the
 * server can send is not guessable from the type:
 *
 * | what the server sends | what a person needs to read |
 * |---|---|
 * | nothing (`[]` or absent) | "its world views" — an older server, not a success |
 * | `{ id: null, name: null }` | "every world view — they could not even be listed" |
 * | an id with a name | the name, with the id in brackets |
 * | an id without a name | the number alone, which is still enough to search by |
 *
 * The middle row is the one a second implementation gets wrong: `id: null` is what
 * the server sends when *listing* the world views is what failed, so there is no
 * number to give, and a naive template renders "world view null" in the one sentence
 * whose whole purpose is to be handed to an admin. Ids travel with names because
 * that is what an admin works from — a curator reporting "Continents" and an admin
 * searching for a world view id are the two halves of one handover.
 */
export function worldViewList(
  failed: Array<{ id: number | null; name: string | null }> | undefined,
): string {
  if (!failed || failed.length === 0) return 'its world views';
  return failed
    .map(view => {
      if (view.id === null) return 'every world view — they could not even be listed';
      return view.name ? `${view.name} (world view ${view.id})` : `world view ${view.id}`;
    })
    .join(', ');
}
