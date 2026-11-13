// Who may do what in the dashboard. These mirror the server's rules so the UI
// only offers actions the server will accept; the server still decides.

// A comment can be deleted by its author or an Admin. Comments from before
// logins existed have no authorId, so only an Admin can remove those.
export function canDeleteComment(comment, user) {
  if (!user) return false
  if (user.role === 'Admin') return true
  return comment?.authorId != null && user.id != null && Number(comment.authorId) === Number(user.id)
}
