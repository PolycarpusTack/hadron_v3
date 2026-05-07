export type DateRangePreset =
  | 'today'
  | 'yesterday'
  | 'last7days'
  | 'last30days'
  | 'thisMonth'
  | 'lastMonth'
  | 'allTime'
  | 'custom';

export interface DateRangeFilter {
  preset: DateRangePreset;
  customRange?: {
    start: string; // ISO 8601 date string
    end: string;
  };
}

export interface TagFilter {
  mode: 'any' | 'all'; // OR vs AND
  tagIds: number[];
  excludeTagIds?: number[];
}

export interface CostFilter {
  min?: number;
  max?: number;
  preset?: 'under1cent' | 'under10cents' | 'over10cents' | 'custom';
}

export interface HistoryFilters {
  search: string;
  severities: string[];
  analysisTypes: string[];
  analysisModes: string[];
  dateRange: DateRangeFilter;
  tags: TagFilter;
  cost: CostFilter;
  showArchived: boolean;
  favoritesOnly: boolean;
  sortBy: 'date' | 'severity' | 'cost' | 'fileSize' | 'filename';
  sortOrder: 'asc' | 'desc';
}

export interface AdvancedFilterOptions {
  search?: string;
  severities?: string[];
  analysisTypes?: string[];
  analysisModes?: string[];
  tagIds?: number[];
  tagMode?: 'any' | 'all';
  dateFrom?: string;
  dateTo?: string;
  costMin?: number;
  costMax?: number;
  includeArchived?: boolean;
  favoritesOnly?: boolean;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface FilteredResults<T> {
  items: T[];
  totalCount: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface BulkOperationResult {
  successCount: number;
  totalRequested: number;
}

export const DEFAULT_HISTORY_FILTERS: HistoryFilters = {
  search: '',
  severities: [],
  analysisTypes: [],
  analysisModes: [],
  dateRange: { preset: 'allTime' },
  tags: { mode: 'any', tagIds: [] },
  cost: {},
  showArchived: false,
  favoritesOnly: false,
  sortBy: 'date',
  sortOrder: 'desc',
};

export function filtersToApiOptions(filters: HistoryFilters, limit = 50, offset = 0): AdvancedFilterOptions {
  const options: AdvancedFilterOptions = {
    limit,
    offset,
    sortBy: filters.sortBy,
    sortOrder: filters.sortOrder,
    includeArchived: filters.showArchived,
    favoritesOnly: filters.favoritesOnly,
  };

  if (filters.search) {
    options.search = filters.search;
  }

  if (filters.severities.length > 0) {
    options.severities = filters.severities;
  }

  if (filters.analysisTypes.length > 0) {
    options.analysisTypes = filters.analysisTypes;
  }

  if (filters.analysisModes.length > 0) {
    options.analysisModes = filters.analysisModes;
  }

  if (filters.tags.tagIds.length > 0) {
    options.tagIds = filters.tags.tagIds;
    options.tagMode = filters.tags.mode;
  }

  const { dateFrom, dateTo } = getDateRangeFromPreset(filters.dateRange);
  if (dateFrom) options.dateFrom = dateFrom;
  if (dateTo) options.dateTo = dateTo;

  if (filters.cost.min !== undefined) {
    options.costMin = filters.cost.min;
  }
  if (filters.cost.max !== undefined) {
    options.costMax = filters.cost.max;
  }

  return options;
}

export function getDateRangeFromPreset(
  dateRange: DateRangeFilter
): { dateFrom?: string; dateTo?: string } {
  const now = new Date();
  const startOfDay = (d: Date) => {
    const copy = new Date(d);
    copy.setHours(0, 0, 0, 0);
    return copy;
  };
  const endOfDay = (d: Date) => {
    const copy = new Date(d);
    copy.setHours(23, 59, 59, 999);
    return copy;
  };

  switch (dateRange.preset) {
    case 'today':
      return {
        dateFrom: startOfDay(now).toISOString(),
        dateTo: endOfDay(now).toISOString(),
      };
    case 'yesterday': {
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      return {
        dateFrom: startOfDay(yesterday).toISOString(),
        dateTo: endOfDay(yesterday).toISOString(),
      };
    }
    case 'last7days': {
      const weekAgo = new Date(now);
      weekAgo.setDate(weekAgo.getDate() - 7);
      return {
        dateFrom: startOfDay(weekAgo).toISOString(),
      };
    }
    case 'last30days': {
      const monthAgo = new Date(now);
      monthAgo.setDate(monthAgo.getDate() - 30);
      return {
        dateFrom: startOfDay(monthAgo).toISOString(),
      };
    }
    case 'thisMonth': {
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      return {
        dateFrom: startOfMonth.toISOString(),
      };
    }
    case 'lastMonth': {
      const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
      return {
        dateFrom: startOfLastMonth.toISOString(),
        dateTo: endOfLastMonth.toISOString(),
      };
    }
    case 'custom':
      if (dateRange.customRange) {
        return {
          dateFrom: dateRange.customRange.start,
          dateTo: dateRange.customRange.end,
        };
      }
      return {};
    case 'allTime':
    default:
      return {};
  }
}
