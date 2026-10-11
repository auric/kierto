// Import a .sql file only with { type: "text" }.
declare module "*.sql" {
  const text: string;
  export default text;
}
