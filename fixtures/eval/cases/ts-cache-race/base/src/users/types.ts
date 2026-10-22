export type User = {
  id: string;
  name: string;
  email: string;
  teamId: string;
  updatedAt: number;
};

export type UserPatch = Partial<Pick<User, "name" | "email" | "teamId">>;
