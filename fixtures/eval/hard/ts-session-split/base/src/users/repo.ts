export type User = { id: string; email: string };

export type UserRepo = {
  // The user when the password matches, else null. It takes the same time for an unknown email.
  checkPassword(email: string, password: string): Promise<User | null>;
  // False when the current password does not match.
  changePassword(userId: string, current: string, next: string): Promise<boolean>;
};
