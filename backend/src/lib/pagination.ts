import { z } from 'zod';

export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type PageQuery = z.infer<typeof pageQuery>;

export const skipTake = ({ page, pageSize }: PageQuery) => ({
  skip: (page - 1) * pageSize,
  take: pageSize,
});

export const pageMeta = ({ page, pageSize }: PageQuery, total: number) => ({
  page,
  pageSize,
  total,
  totalPages: Math.ceil(total / pageSize),
});
