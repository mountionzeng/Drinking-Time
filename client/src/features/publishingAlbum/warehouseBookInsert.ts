export const INSERT_WAREHOUSE_BOOK = "dt:insert-warehouse-book";
export type WarehouseBookInsert = {
  storyId: number;
  text: string;
  accepted?: boolean;
};
