export type UserRole = 'candidate' | 'employer' | 'admin';
export type AccountStatus = 'active' | 'paused' | 'deleted';
export type WorkSituation = 'seeking_job' | 'Employed_seeking_change';

export interface IndustryItem {
  id: string;
  slug: string;
  name: string;
  suggested_positions: string[];
  is_active: boolean;
}

export interface LocalityItem {
  id: string;
  name: string;
  district: string;
  is_active: boolean;
}

export interface CandidateCardPublic {
  id: string;
  first_name: string;
  last_name: string;
  avatar_url: string | null;
  locality: string;
  work_situation: WorkSituation;
  availability: string[];
  education_level: string;
  industries: string[];
  positions: string[];
  custom_other_text: string | null;
  bio_short: string;
  has_cv: boolean;
  is_searching: boolean;
  status: AccountStatus;
  created_at: string;
}

export interface EmployerProfilePublic {
  id: string;
  trade_name: string;
  legal_name: string | null;
  cuit: string | null;
  logo_url: string | null;
  industry: string;
  locality: string;
  description: string;
  status: AccountStatus;
  created_at: string;
}

export interface JobPostPublic {
  id: string;
  employer_id: string;
  trade_name: string;
  logo_url: string | null;
  title: string;
  industry: string;
  position_tag: string;
  locality: string;
  availability: string[];
  required_education: string;
  description: string;
  status: 'active' | 'paused' | 'closed' | 'expired';
  created_at: string;
}
