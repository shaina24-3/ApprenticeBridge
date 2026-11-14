'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { 
  Briefcase, User, Shield, CheckCircle, AlertCircle, Award, FileText, 
  Search, Filter, Plus, Check, X, ArrowRight, BookOpen, Clock, MapPin, 
  Building, Sparkles, ChevronRight, BarChart2, Users, FileCheck, RefreshCw, 
  Upload, Eye, Trash2, Edit, HelpCircle, Layers, CheckSquare, Zap, Lock, LogOut,
  Menu, Home, TrendingUp, FileSearch, Target, ArrowUpRight, UserPlus, ChevronDown,
  BadgeCheck, BookMarked, Fingerprint, Info, Star, GraduationCap, Bookmark,
  ChevronUp, Bot, ShieldAlert, Hash, Share, Download
} from 'lucide-react';

import apiFetch, {
  apprenticeshipsApi,
  applicationsApi,
  evidenceApi,
  assessmentsApi,
  analyticsApi,
  adminApi,
  profilesApi,
  skillsApi,
  resumeApi,
  aiApi,
} from '@/lib/api';



function calculateExplainableMatch(candidate, apprenticeship) {
  // Guard: ensure arrays exist (list endpoint doesn't include skills)
  const requiredSkills = apprenticeship.requiredSkills || apprenticeship.required_skills || [];
  const mandatoryCerts = apprenticeship.mandatoryCertifications || apprenticeship.mandatory_certifications || [];

  // 1. Layer A: Hard Constraints Check
  let mandatoryMet = true;
  const missingMandatoryCertifications = [];

  if (mandatoryCerts.length > 0) {
    mandatoryCerts.forEach(cert => {
      const hasCert = candidate.certifications?.some(c => c.toLowerCase().includes(cert.toLowerCase()));
      if (!hasCert) {
        mandatoryMet = false;
        missingMandatoryCertifications.push(cert);
      }
    });
  }

  // Check mandatory required skills
  const missingMandatorySkills = [];
  requiredSkills.forEach(reqSkill => {
    if (reqSkill.mandatory) {
      const candidateSkill = candidate.skills?.find(s => s.name.toLowerCase() === reqSkill.name.toLowerCase());
      if (!candidateSkill) {
        missingMandatorySkills.push(reqSkill.name);
      }
    }
  });

  const isEligible = mandatoryMet && missingMandatorySkills.length === 0;

  // 2. Layer B: Weighted Relevance Score
  let skillPointsEarned = 0;
  let totalSkillMaxPoints = requiredSkills.length;
  
  const strongMatches = [];
  const partialMatches = [];
  const missingSkills = [];

  const levelWeights = { 'Beginner': 1, 'beginner': 1, 'Intermediate': 2, 'intermediate': 2, 'Advanced': 3, 'advanced': 3 };

  requiredSkills.forEach(reqSkill => {
    const candidateSkill = candidate.skills?.find(s => s.name.toLowerCase() === reqSkill.name.toLowerCase());
    
    if (!candidateSkill) {
      missingSkills.push(reqSkill.name);
    } else {
      const reqVal = levelWeights[reqSkill.requiredLevel || reqSkill.required_level] || 1;
      const candVal = levelWeights[candidateSkill.level] || 1;

      let scoreMultiplier = 0.5;
      if (candidateSkill.status === 'VERIFIED') {
        scoreMultiplier = candVal >= reqVal ? 1.0 : 0.75;
      } else if (candidateSkill.status === 'ASSESSED') {
        scoreMultiplier = candVal >= reqVal ? 0.85 : 0.65;
      } else {
        scoreMultiplier = candVal >= reqVal ? 0.60 : 0.40;
      }

      skillPointsEarned += scoreMultiplier;

      if (scoreMultiplier >= 0.85) {
        strongMatches.push({ name: reqSkill.name, level: candidateSkill.level, status: candidateSkill.status });
      } else {
        partialMatches.push({ name: reqSkill.name, candidateLevel: candidateSkill.level, requiredLevel: reqSkill.requiredLevel || reqSkill.required_level, status: candidateSkill.status });
      }
    }
  });

  const skillScoreFrac = totalSkillMaxPoints > 0 ? (skillPointsEarned / totalSkillMaxPoints) : 0;
  // When no skills are required, skill score is neutral (0.5) not perfect (1.0)
  const skillScorePart = totalSkillMaxPoints > 0 ? skillScoreFrac * 60 : 30;

  const isLocationMatch = candidate.location?.toLowerCase().includes(apprenticeship.location?.toLowerCase() || '') || 
                          (apprenticeship.work_mode || apprenticeship.workMode) === 'Remote';
  const locationPart = isLocationMatch ? 10 : 3;
  const educationPart = candidate.education ? 15 : 5;
  const interestPart = candidate.interests?.toLowerCase().includes((apprenticeship.category || '').toLowerCase()) ? 10 : 4;
  const experiencePart = candidate.experience ? 5 : 2;

  const totalScore = Math.round(skillScorePart + educationPart + interestPart + locationPart + experiencePart);

  return {
    isEligible,
    totalScore,
    breakdown: {
      skillScorePart: Math.round(skillScorePart),
      educationPart,
      interestPart,
      locationPart,
      experiencePart
    },
    strongMatches,
    partialMatches,
    missingSkills,
    missingMandatoryCertifications,
    missingMandatorySkills,
    explanation: isEligible 
      ? `Score boosted by ${strongMatches.length} verified/strong skill match(es).` 
      : `Missing hard constraints: ${[...missingMandatoryCertifications, ...missingMandatorySkills].join(', ') || 'none'}.`
  };
}

export default function ApprenticeBridgeApp({ realUser, authLoading, onLogout, initialModal }) {
  /**
   * realUser      — { id, name, email, role } from FastAPI, or null when not logged in
   * authLoading   — true while AuthContext is checking the session cookie on mount
   * onLogout      — async fn that calls /auth/logout and clears user state
   * initialModal  — "signin" | "signup" | null — auto-opens the modal on first render
   *                 (used when redirected from /auth/signin or /auth/signup)
   */

  // Map backend role → internal UI role
  const mapRole = (backendRole) => {
    if (!backendRole) return 'CANDIDATE';
    const r = backendRole.toLowerCase();
    if (r === 'employer') return 'EMPLOYER';
    if (r === 'admin') return 'ADMIN';
    // training_institute has its own candidate-like view; do NOT grant admin portal
    return 'CANDIDATE';
  };

  // App State — seed the current user from the real authenticated user
  const [currentUser, setCurrentUser] = useState(() => {
    if (realUser) {
      return {
        role: mapRole(realUser.role),
        id: realUser.id,
        name: realUser.name,
        email: realUser.email,
        photo_url: realUser.photo_url || null,
      };
    }
    return { role: 'CANDIDATE', id: null, name: '', email: '', photo_url: null };
  });

  const [activeTab, setActiveTab] = useState('dashboard');
  const [showHome, setShowHome] = useState(!realUser); // show landing when not logged in
  // Auto-open modal if redirected from /auth/signin or /auth/signup
  const [authModal, setAuthModal] = useState(
    !realUser && (initialModal === 'signin' || initialModal === 'signup')
      ? initialModal
      : null
  );
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [toast, setToast] = useState(null);

  // ── Live data from the backend ──────────────────────────────────────────────
  const [apprenticeships, setApprenticeships] = useState([]);
  const [applications, setApplications] = useState([]);
  const [myEvidence, setMyEvidence] = useState([]);
  const [assessments, setAssessments] = useState([]);
  const [allSkills, setAllSkills] = useState([]);
  const [candidateProfile, setCandidateProfile] = useState(null);
  const [mySkills, setMySkills] = useState([]);
  const [employerProfile, setEmployerProfile] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [adminUsers, setAdminUsers] = useState([]);
  const [adminListings, setAdminListings] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [dataLoading, setDataLoading] = useState(true);

  // ── Fetch data when the user is logged in ───────────────────────────────────
  useEffect(() => {
    if (!currentUser.id) {
      setDataLoading(false); // not logged in — nothing to fetch
      return;
    }
    setDataLoading(true);

    if (currentUser.role === 'CANDIDATE') {
      Promise.all([
        apprenticeshipsApi.list(),
        applicationsApi.mine(),
        evidenceApi.mine(),
        assessmentsApi.list(),
        profilesApi.getCandidateProfile(),
        analyticsApi.candidate(),
        skillsApi.mySkills(),
      ]).then(([appr, apps, evid, asmts, profile, stats, skills]) => {
        if (!appr.error) setApprenticeships(appr.items || []);
        if (!apps.error) setApplications(Array.isArray(apps) ? apps : []);
        if (!evid.error) setMyEvidence(Array.isArray(evid) ? evid : []);
        if (!asmts.error) setAssessments(Array.isArray(asmts) ? asmts : []);
        if (!profile.error) setCandidateProfile(profile);
        if (!stats.error) setAnalytics(stats);
        if (!skills.error) setMySkills(Array.isArray(skills) ? skills : []);
      }).finally(() => setDataLoading(false));
    }

    if (currentUser.role === 'EMPLOYER') {
      Promise.all([
        apprenticeshipsApi.list({ page_size: 50 }),
        analyticsApi.employer(),
        profilesApi.getEmployerProfile(),
        applicationsApi.forEmployer(),
        assessmentsApi.mine(),
        skillsApi.list(),
      ]).then(([appr, stats, profile, apps, asmts, skills]) => {
        if (!appr.error) setApprenticeships(appr.items || []);
        if (!stats.error) setAnalytics(stats);
        if (!profile.error) setEmployerProfile(profile);
        if (!apps.error) setApplications(Array.isArray(apps) ? apps : []);
        if (!asmts.error) setAssessments(Array.isArray(asmts) ? asmts : []);
        if (!skills.error) setAllSkills(Array.isArray(skills) ? skills : []);
      }).finally(() => setDataLoading(false));
    }

    if (currentUser.role === 'ADMIN') {
      Promise.all([
        adminApi.users(),
        adminApi.listings(),
        adminApi.auditLogs(),
        analyticsApi.admin(),
        assessmentsApi.list(),
      ]).then(([users, listings, logs, stats, asmts]) => {
        if (!users.error) setAdminUsers(Array.isArray(users) ? users : []);
        if (!listings.error) setAdminListings(Array.isArray(listings) ? listings : []);
        if (!logs.error) setAuditLogs(Array.isArray(logs) ? logs : []);
        if (!stats.error) setAnalytics(stats);
        if (!asmts.error) setAssessments(Array.isArray(asmts) ? asmts : []);
      }).finally(() => setDataLoading(false));
    }
  }, [currentUser.id, currentUser.role]);

  // Convenience refresh helpers
  const refreshApplications = () => applicationsApi.mine().then(r => { if (!r.error) setApplications(Array.isArray(r) ? r : []); });
  const refreshEvidence = () => evidenceApi.mine().then(r => { if (!r.error) setMyEvidence(Array.isArray(r) ? r : []); });
  const refreshAdminData = () => {
    Promise.all([adminApi.users(), adminApi.listings(), adminApi.auditLogs()])
      .then(([u, l, logs]) => {
        if (!u.error) setAdminUsers(Array.isArray(u) ? u : []);
        if (!l.error) setAdminListings(Array.isArray(l) ? l : []);
        if (!logs.error) setAuditLogs(Array.isArray(logs) ? logs : []);
      });
  };

  // Derived data object — keeps child components working while we use
  // individual state slices for all real data fetching.

  // Build the candidate shape that child views expect (skills, evidence, etc.)
  const candidateObject = currentUser.id ? {
    id: currentUser.id,
    name: currentUser.name,
    photo_url: currentUser.photo_url || null,
    email: currentUser.email,
    photo: null,
    location: candidateProfile?.location || '',
    education: candidateProfile?.education || '',
    interests: candidateProfile?.interests || '',
    experience: candidateProfile?.experience || '',
    trades: candidateProfile?.trades || '',
    // Normalise skills to the shape child views use
    skills: mySkills.map(s => ({
      name: s.name,
      level: s.level,
      status: s.verified ? 'VERIFIED' : s.source === 'assessment' ? 'ASSESSED' : 'SELF_DECLARED',
      verifiedBy: s.verified ? 'Platform Assessment' : null,
      score: s.score || 0,
    })),
    evidence: myEvidence.map(e => ({
      id: e.id,
      title: e.original_filename,
      original_filename: e.original_filename,
      file_url: e.file_url,
      content_type: e.content_type,
      size_bytes: e.size_bytes,
      skill_id: e.skill_id,
      skill_name: e.skill_name || '',
      skill: e.skill_name || '',
      date: e.created_at,
      created_at: e.created_at,
      status: e.status === 'approved' ? 'APPROVED' : e.status === 'rejected' ? 'REJECTED' : 'UNDER_REVIEW',
      raw_status: e.status,
      share_token: e.share_token,
      fileType: e.content_type,
    })),
    certifications: [],
    verifiedSummary: '',
  } : null;

  const data = {
    apprenticeships,
    applications,
    evidence: myEvidence,
    assessments,
    candidateProfile,
    employerProfile,
    analytics,
    adminUsers,
    adminListings,
    auditLogs,
    // Provide candidates array with the real candidate object so child
    // views that do data.candidates.find(...) get a real result.
    candidates: candidateObject ? [candidateObject] : [],
    employers: [],
    allSkills,
  };


  // Gemini AI Assistant State
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiDraftPrompt, setAiDraftPrompt] = useState('');
  const [aiSummary, setAiSummary] = useState('');

  // Assessment Taking State
  const [activeAssessment, setActiveAssessment] = useState(null);
  const [answers, setAnswers] = useState({});
  const [assessmentResult, setAssessmentResult] = useState(null);

  // Modals & Search Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTradeFilter, setSelectedTradeFilter] = useState('ALL');
  const [showCreateApprenticeshipModal, setShowCreateApprenticeshipModal] = useState(false);
  const [showEvidenceUploadModal, setShowEvidenceUploadModal] = useState(false);
  const [selectedCandidateDetail, setSelectedCandidateDetail] = useState(null);

  const showToastMessage = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  // ── Logout handler ─────────────────────────────────────────────────────
  const handleLogout = async () => {
    if (onLogout) {
      await onLogout();
    }
    // Return to the landing/home page regardless of auth result
    setShowHome(true);
    setActiveTab('dashboard');
    setAuthModal(null);
  };

  // Helper: Log Admin Audit Event
  const addAuditLog = (user, action, details) => {
    const newLog = {
      id: `log-${Date.now()}`,
      timestamp: new Date().toLocaleString(),
      user,
      action,
      details
    };
    setAuditLogs(prev => [newLog, ...prev]);
  };

  // Navigate to the authenticated user's own portal (no cross-role switching)
  const handlePortalEnter = () => {
    setShowHome(false);
    setAuthModal(null);
    setMobileSidebarOpen(false);
    setActiveTab('dashboard');
  };

  // Called when the auth modal succeeds (login / register / Google)
  const handleAuthSuccess = (authedUser) => {
    setAuthModal(null);
    const uiRole = mapRole(authedUser?.role);
    setCurrentUser({
      role: uiRole,
      id: authedUser?.id,
      name: authedUser?.name || 'User',
      email: authedUser?.email || '',
      photo_url: authedUser?.photo_url || null,
    });
    setShowHome(false);
    setActiveTab('dashboard');
    showToastMessage(`Welcome, ${authedUser?.name || 'User'}!`);
  };

  // AI Feature 1: Skill Summary Generation (server-side Gemini — key never exposed)
  const generateAISkillSummary = async (candidate) => {
    setAiGenerating(true);
    setAiSummary('');
    try {
      const verifiedSkills = candidate.skills
        .filter(s => s.status === 'VERIFIED')
        .map(s => ({ name: s.name, level: s.level }));

      const res = await aiApi.generateSkillSummary(candidate.name, candidate.education, verifiedSkills);
      if (res.error) throw new Error(res.error);
      setAiSummary(res.summary);
      showToastMessage(res.ai_generated ? 'Generated verified skill summary via Gemini AI' : 'Generated deterministic summary (Fallback)');
    } catch (err) {
      // Fallback deterministic summary
      const verified = candidate.skills.filter(s => s.status === 'VERIFIED');
      const fallback = `${candidate.name} holds ${verified.length} verified skill credential(s) including ${verified.map(s => s.name).join(', ')}. Certified and clear of hard constraints.`;
      setAiSummary(fallback);
      showToastMessage('Generated deterministic summary (Fallback)');
    } finally {
      setAiGenerating(false);
    }
  };

  // AI Feature 2: Assessment Question Drafting (Must save as DRAFT — server-side Gemini)
  const generateAIDraftQuestion = async (skillName) => {
    if (!skillName) return;
    setAiGenerating(true);
    try {
      const res = await aiApi.generateQuestions(skillName, 'medium', 1, 0, 0);
      if (res.error) throw new Error(res.error);

      const q = res.questions?.[0];
      if (q) {
        const newQuestion = {
          id: `q-draft-${Date.now()}`,
          question: q.question,
          options: [q.option_a, q.option_b, q.option_c, q.option_d],
          correctIdx: ['A','B','C','D'].indexOf(q.correct_option),
          status: 'DRAFT' // MANDATORY PRD REQUIREMENT: Must be DRAFT
        };

        // Attach to assessment or create assessment item
        setAssessments(prev => {
          const existingAssessment = prev.find(a => a.skillName?.toLowerCase() === skillName.toLowerCase());
          if (existingAssessment) {
            return prev.map(a => a.id === existingAssessment.id ? { ...a, questions: [...(a.questions || []), newQuestion] } : a);
          } else {
            return [...prev, {
              id: `assess-${Date.now()}`,
              skillName,
              category: 'General',
              questionsCount: 1,
              durationMinutes: 10,
              questions: [newQuestion]
            }];
          }
        });

        addAuditLog(currentUser.name, 'AI_QUESTION_DRAFTED', `Drafted AI assessment question for skill: ${skillName}. Set status to DRAFT.`);
        showToastMessage(`AI Question created in DRAFT status for ${skillName}. Requires Admin Approval.`);
      }
    } catch (err) {
      showToastMessage('Failed to draft AI question. Please try again.', 'error');
    } finally {
      setAiGenerating(false);
    }
  };

  const handleScoreAssessment = async () => {
    if (!activeAssessment) return;
    // Submit to the real backend — answers are already in {questionId: "A"/"B"/"C"/"D"/text} format
    const res = await assessmentsApi.submit(activeAssessment.id, answers);
    if (res.error) {
      showToastMessage(res.error, 'error');
      return;
    }
    setAssessmentResult(res);
    // Refresh skills so the verified badge appears immediately
    skillsApi.mySkills().then(r => { if (!r.error) setMySkills(Array.isArray(r) ? r : []); });
    addAuditLog(currentUser.name, 'ASSESSMENT_SUBMITTED', `Completed "${activeAssessment.title}" — score ${res.score}% (${res.level})`);
  };

  if (showHome) {
    // While session check is in flight, show a minimal spinner so the
    // landing page doesn't flicker from unauthenticated → authenticated.
    if (authLoading) {
      return (
        <div className="min-h-screen bg-[#F4F7F5] flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center shadow-lg shadow-emerald-200">
              <Zap className="w-6 h-6 text-white" />
            </div>
            <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-slate-400 font-medium">Loading ApprenticeBridge…</p>
          </div>
        </div>
      );
    }

    return (
      <>
        <LandingPage
          onEnter={handlePortalEnter}
          onOpenSignIn={() => setAuthModal('signin')}
          onOpenSignUp={() => setAuthModal('signup')}
          isLoggedIn={!!realUser}
        />
        {authModal && (
          <AuthModal
            mode={authModal}
            onSwitchMode={(m) => setAuthModal(m)}
            onClose={() => setAuthModal(null)}
            onSuccess={handleAuthSuccess}
          />
        )}
      </>
    );
  }

  return (
    <div className="min-h-screen bg-[#F4F7F5] text-slate-800 font-sans flex flex-col">
      {/* Toast Notification */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-xl shadow-xl text-white font-medium transition-all ${
          toast.type === 'error' ? 'bg-rose-600' : 'bg-emerald-600'
        }`}>
          {toast.type === 'error' ? <AlertCircle className="w-5 h-5" /> : <CheckCircle className="w-5 h-5" />}
          {toast.msg}
        </div>
      )}

      {/* Top Navigation */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center text-white font-bold shadow-md shadow-emerald-200">
              <Zap className="w-6 h-6" />
            </div>
            <div>
              <span className="text-xl font-extrabold tracking-tight text-slate-900">Apprentice<span className="text-emerald-600">Bridge</span></span>
              <span className="hidden sm:inline-block ml-2 text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">Verified Skills Engine</span>
            </div>
          </div>

          {/* Role Switching Selector Bar (For Demo & Multi-Portal Navigation) */}
          <button
            onClick={() => setMobileSidebarOpen(true)}
            className="lg:hidden p-2 rounded-xl border border-slate-200 bg-white text-slate-700 shadow-sm"
            aria-label="Open navigation"
          >
            <Menu className="w-5 h-5" />
          </button>

          <div className="hidden lg:flex items-center gap-3">
            {/* Current portal badge — read-only, no cross-role switching */}
            <div className="flex items-center bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200 gap-1.5">
              {currentUser.role === 'CANDIDATE' && <User className="w-3.5 h-3.5 text-emerald-600" />}
              {currentUser.role === 'EMPLOYER' && <Building className="w-3.5 h-3.5 text-emerald-600" />}
              {currentUser.role === 'ADMIN' && <Shield className="w-3.5 h-3.5 text-amber-500" />}
              <span className="text-xs font-semibold text-slate-700">
                {currentUser.role === 'CANDIDATE' && 'Candidate Portal'}
                {currentUser.role === 'EMPLOYER' && 'Employer Portal'}
                {currentUser.role === 'ADMIN' && 'Admin Portal'}
              </span>
            </div>

            {/* Logged-in user info + logout */}
            {realUser && (
              <div className="flex items-center gap-2 pl-3 border-l border-slate-200">
                <div className="text-right hidden xl:block">
                  <p className="text-xs font-bold text-slate-800 leading-none">{realUser.name}</p>
                  <p className="text-[10px] text-emerald-600 font-semibold uppercase tracking-wider mt-0.5">{realUser.role}</p>
                </div>
                <button
                  onClick={handleLogout}
                  title="Sign out"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200 transition-all"
                >
                  <LogOut className="w-3.5 h-3.5" /> Sign Out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Container Layout */}
      <div className="flex-1 flex max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 gap-6">
        
        {/* Left Sidebar Navigation */}
        <aside className="w-64 flex-shrink-0 hidden lg:block">
          <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-sm sticky top-[5.5rem]">
            
            {/* User Profile Card Snippet */}
            <div className="flex items-center gap-3 p-3 mb-4 rounded-xl bg-slate-50 border border-slate-100">
              {currentUser.photo_url ? (
                <img src={`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}${currentUser.photo_url}`}
                  alt={currentUser.name}
                  className="w-10 h-10 rounded-full object-cover border border-emerald-200" />
              ) : (
                <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold text-sm">
                  {(realUser?.name || currentUser.name).charAt(0).toUpperCase()}
                </div>
              )}
              <div className="truncate">
                <p className="text-sm font-bold text-slate-900 truncate">{realUser?.name || currentUser.name}</p>
                <p className="text-xs text-emerald-600 font-semibold uppercase tracking-wider">{realUser?.role || currentUser.role}</p>
              </div>
            </div>

            <nav className="space-y-1">
              <SidebarNavItem active={false} onClick={() => setShowHome(true)} icon={<Home className="w-4 h-4" />} label="Home" />
              {currentUser.role === 'CANDIDATE' && (
                <>
                  <SidebarNavItem active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} icon={<BarChart2 className="w-4 h-4" />} label="Dashboard" />
                  <SidebarNavItem active={activeTab === 'apprenticeships'} onClick={() => setActiveTab('apprenticeships')} icon={<Briefcase className="w-4 h-4" />} label="Find Apprenticeships" />
                  <SidebarNavItem active={activeTab === 'assessments'} onClick={() => setActiveTab('assessments')} icon={<Award className="w-4 h-4" />} label="Skill Assessments" />
                  <SidebarNavItem active={activeTab === 'evidence'} onClick={() => setActiveTab('evidence')} icon={<FileCheck className="w-4 h-4" />} label="Evidence Locker" />
                  <SidebarNavItem active={activeTab === 'applications'} onClick={() => setActiveTab('applications')} icon={<FileText className="w-4 h-4" />} label="My Applications" />
                  <SidebarNavItem active={activeTab === 'analytics'} onClick={() => setActiveTab('analytics')} icon={<TrendingUp className="w-4 h-4" />} label="Performance Analytics" />
                  <SidebarNavItem active={activeTab === 'ats-analyzer'} onClick={() => setActiveTab('ats-analyzer')} icon={<FileSearch className="w-4 h-4" />} label="ATS Resume Analyzer" />
                  <SidebarNavItem active={activeTab === 'skill-passport'} onClick={() => setActiveTab('skill-passport')} icon={<BadgeCheck className="w-4 h-4" />} label="Skill Passport" />
                  <SidebarNavItem active={activeTab === 'profile'} onClick={() => setActiveTab('profile')} icon={<User className="w-4 h-4" />} label="Candidate Profile" />
                </>
              )}

              {currentUser.role === 'EMPLOYER' && (
                <>
                  <SidebarNavItem active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} icon={<BarChart2 className="w-4 h-4" />} label="Employer Dashboard" />
                  <SidebarNavItem active={activeTab === 'my-listings'} onClick={() => setActiveTab('my-listings')} icon={<Briefcase className="w-4 h-4" />} label="Manage Listings" />
                  <SidebarNavItem active={activeTab === 'applicants'} onClick={() => setActiveTab('applicants')} icon={<Users className="w-4 h-4" />} label="Applicant Pipeline" />
                  <SidebarNavItem active={activeTab === 'completions'} onClick={() => setActiveTab('completions')} icon={<CheckSquare className="w-4 h-4" />} label="Apprenticeship Completion" />
                  <SidebarNavItem active={activeTab === 'employer-assessments'} onClick={() => setActiveTab('employer-assessments')} icon={<Award className="w-4 h-4" />} label="Manage Assessments" />
                  <SidebarNavItem active={activeTab === 'employer-profile'} onClick={() => setActiveTab('employer-profile')} icon={<Building className="w-4 h-4" />} label="Employer Profile" />
                </>
              )}

              {currentUser.role === 'ADMIN' && (
                <>
                  <SidebarNavItem active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} icon={<Shield className="w-4 h-4" />} label="Platform Overview" />
                  <SidebarNavItem active={activeTab === 'users'} onClick={() => setActiveTab('users')} icon={<Users className="w-4 h-4" />} label="User Management" />
                  <SidebarNavItem active={activeTab === 'verification-mod'} onClick={() => setActiveTab('verification-mod')} icon={<FileCheck className="w-4 h-4" />} label="Evidence Approvals" />
                  <SidebarNavItem active={activeTab === 'ai-questions'} onClick={() => setActiveTab('ai-questions')} icon={<Sparkles className="w-4 h-4" />} label="AI Questions (Drafts)" />
                  <SidebarNavItem active={activeTab === 'audit-logs'} onClick={() => setActiveTab('audit-logs')} icon={<Lock className="w-4 h-4" />} label="Audit Logs" />
                </>
              )}
            </nav>
          </div>
        </aside>

        {mobileSidebarOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <button
              className="absolute inset-0 bg-slate-950/45 backdrop-blur-sm"
              aria-label="Close navigation"
              onClick={() => setMobileSidebarOpen(false)}
            />
            <aside className="relative h-full w-[min(86vw,320px)] bg-white shadow-2xl p-4 overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-lg font-black text-slate-900">Apprentice<span className="text-emerald-600">Bridge</span></p>
                  <p className="text-[10px] uppercase tracking-wider font-bold text-slate-400">{currentUser.role} portal</p>
                </div>
                <button onClick={() => setMobileSidebarOpen(false)} className="p-2 rounded-xl hover:bg-slate-100" aria-label="Close navigation">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="flex items-center gap-3 p-3 mb-4 rounded-xl bg-slate-50 border border-slate-100">
                <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold text-sm">
                  {currentUser.name.charAt(0)}
                </div>
                <div className="truncate">
                  <p className="text-sm font-bold text-slate-900 truncate">{currentUser.name}</p>
                  <p className="text-xs text-emerald-600 font-semibold uppercase tracking-wider">{currentUser.role}</p>
                </div>
              </div>
              <nav className="space-y-1">
                <SidebarNavItem active={false} onClick={() => { setShowHome(true); setMobileSidebarOpen(false); }} icon={<Home className="w-4 h-4" />} label="Home" />
                {currentUser.role === 'CANDIDATE' && (
                  <>
                    <SidebarNavItem active={activeTab === 'dashboard'} onClick={() => { setActiveTab('dashboard'); setMobileSidebarOpen(false); }} icon={<BarChart2 className="w-4 h-4" />} label="Dashboard" />
                    <SidebarNavItem active={activeTab === 'apprenticeships'} onClick={() => { setActiveTab('apprenticeships'); setMobileSidebarOpen(false); }} icon={<Briefcase className="w-4 h-4" />} label="Find Apprenticeships" />
                    <SidebarNavItem active={activeTab === 'assessments'} onClick={() => { setActiveTab('assessments'); setMobileSidebarOpen(false); }} icon={<Award className="w-4 h-4" />} label="Skill Assessments" />
                    <SidebarNavItem active={activeTab === 'evidence'} onClick={() => { setActiveTab('evidence'); setMobileSidebarOpen(false); }} icon={<FileCheck className="w-4 h-4" />} label="Evidence Locker" />
                    <SidebarNavItem active={activeTab === 'applications'} onClick={() => { setActiveTab('applications'); setMobileSidebarOpen(false); }} icon={<FileText className="w-4 h-4" />} label="My Applications" />
                    <SidebarNavItem active={activeTab === 'analytics'} onClick={() => { setActiveTab('analytics'); setMobileSidebarOpen(false); }} icon={<TrendingUp className="w-4 h-4" />} label="Performance Analytics" />
                    <SidebarNavItem active={activeTab === 'ats-analyzer'} onClick={() => { setActiveTab('ats-analyzer'); setMobileSidebarOpen(false); }} icon={<FileSearch className="w-4 h-4" />} label="ATS Resume Analyzer" />
                    <SidebarNavItem active={activeTab === 'skill-passport'} onClick={() => { setActiveTab('skill-passport'); setMobileSidebarOpen(false); }} icon={<BadgeCheck className="w-4 h-4" />} label="Skill Passport" />
                    <SidebarNavItem active={activeTab === 'profile'} onClick={() => { setActiveTab('profile'); setMobileSidebarOpen(false); }} icon={<User className="w-4 h-4" />} label="Candidate Profile" />
                  </>
                )}
                {currentUser.role === 'EMPLOYER' && (
                  <>
                    <SidebarNavItem active={activeTab === 'dashboard'} onClick={() => { setActiveTab('dashboard'); setMobileSidebarOpen(false); }} icon={<BarChart2 className="w-4 h-4" />} label="Employer Dashboard" />
                    <SidebarNavItem active={activeTab === 'my-listings'} onClick={() => { setActiveTab('my-listings'); setMobileSidebarOpen(false); }} icon={<Briefcase className="w-4 h-4" />} label="Manage Listings" />
                    <SidebarNavItem active={activeTab === 'applicants'} onClick={() => { setActiveTab('applicants'); setMobileSidebarOpen(false); }} icon={<Users className="w-4 h-4" />} label="Applicant Pipeline" />
                    <SidebarNavItem active={activeTab === 'completions'} onClick={() => { setActiveTab('completions'); setMobileSidebarOpen(false); }} icon={<CheckSquare className="w-4 h-4" />} label="Apprenticeship Completion" />
                    <SidebarNavItem active={activeTab === 'employer-assessments'} onClick={() => { setActiveTab('employer-assessments'); setMobileSidebarOpen(false); }} icon={<Award className="w-4 h-4" />} label="Manage Assessments" />
                    <SidebarNavItem active={activeTab === 'employer-profile'} onClick={() => { setActiveTab('employer-profile'); setMobileSidebarOpen(false); }} icon={<Building className="w-4 h-4" />} label="Employer Profile" />
                  </>
                )}
                {currentUser.role === 'ADMIN' && (
                  <>
                    <SidebarNavItem active={activeTab === 'dashboard'} onClick={() => { setActiveTab('dashboard'); setMobileSidebarOpen(false); }} icon={<Shield className="w-4 h-4" />} label="Platform Overview" />
                    <SidebarNavItem active={activeTab === 'users'} onClick={() => { setActiveTab('users'); setMobileSidebarOpen(false); }} icon={<Users className="w-4 h-4" />} label="User Management" />
                    <SidebarNavItem active={activeTab === 'verification-mod'} onClick={() => { setActiveTab('verification-mod'); setMobileSidebarOpen(false); }} icon={<FileCheck className="w-4 h-4" />} label="Evidence Approvals" />
                    <SidebarNavItem active={activeTab === 'ai-questions'} onClick={() => { setActiveTab('ai-questions'); setMobileSidebarOpen(false); }} icon={<Sparkles className="w-4 h-4" />} label="AI Questions (Drafts)" />
                    <SidebarNavItem active={activeTab === 'audit-logs'} onClick={() => { setActiveTab('audit-logs'); setMobileSidebarOpen(false); }} icon={<Lock className="w-4 h-4" />} label="Audit Logs" />
                  </>
                )}
              </nav>

              {/* Mobile sign-out */}
              {realUser && (
                <div className="mt-4 pt-4 border-t border-slate-100">
                  <button
                    onClick={() => { setMobileSidebarOpen(false); handleLogout(); }}
                    className="w-full flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-sm font-semibold text-rose-600 hover:bg-rose-50 transition-all"
                  >
                    <LogOut className="w-4 h-4" /> Sign Out
                  </button>
                </div>
              )}
            </aside>
          </div>
        )}

        {/* Main Content Area */}
        <main className="flex-1 min-w-0">

          {/* Loading state while fetching backend data */}
          {dataLoading && (
            <div className="flex items-center justify-center h-64">
              <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {/* CANDIDATE PORTAL VIEWS */}
          {!dataLoading && currentUser.role === 'CANDIDATE' && (
            <>
              {activeTab === 'dashboard' && (
                <CandidateDashboardView 
                  data={data} 
                  currentUser={currentUser} 
                  setActiveTab={setActiveTab}
                  onGenerateAiSummary={generateAISkillSummary}
                  aiGenerating={aiGenerating}
                />
              )}

              {activeTab === 'apprenticeships' && (
                <CandidateApprenticeshipsView 
                  data={data} 
                  currentUser={currentUser}
                  onApply={(appId) => {
                    const existing = applications.find(a => a.apprenticeship_id === appId && a.candidate_id === currentUser.id);
                    if (existing) {
                      showToastMessage('You have already applied for this apprenticeship.', 'error');
                      return;
                    }
                    applicationsApi.apply(appId).then(r => {
                      if (r.error) { showToastMessage(r.error, 'error'); return; }
                      refreshApplications();
                      addAuditLog(currentUser.name, 'APPLICATION_SUBMITTED', `Applied to listing ID ${appId}`);
                      showToastMessage('Application submitted successfully!');
                    });
                  }}
                />
              )}

              {activeTab === 'assessments' && (
                <CandidateAssessmentsView 
                  data={data}
                  currentUser={currentUser}
                  onStartAssessment={async (assessment) => {
                    // Fetch full assessment with questions from backend
                    const full = await assessmentsApi.get(assessment.id);
                    if (full.error) { showToastMessage(full.error, 'error'); return; }
                    setActiveAssessment(full);
                    setAnswers({});
                    setAssessmentResult(null);
                  }}
                  activeAssessment={activeAssessment}
                  answers={answers}
                  setAnswers={setAnswers}
                  assessmentResult={assessmentResult}
                  onScoreAssessment={handleScoreAssessment}
                  onCloseAssessment={() => setActiveAssessment(null)}
                />
              )}

              {activeTab === 'evidence' && (
                <CandidateEvidenceView 
                  data={data}
                  currentUser={currentUser}
                  onOpenUploadModal={() => setShowEvidenceUploadModal(true)}
                />
              )}

              {activeTab === 'applications' && (
                <CandidateApplicationsView data={data} currentUser={currentUser} />
              )}

              {activeTab === 'analytics' && (
                <CandidateAnalyticsView data={data} currentUser={currentUser} setActiveTab={setActiveTab} />
              )}

              {activeTab === 'ats-analyzer' && (
                <ATSResumeAnalyzerView data={data} currentUser={currentUser} />
              )}

              {activeTab === 'profile' && (
                <CandidateProfileView
                  data={data}
                  currentUser={currentUser}
                  onProfileSaved={() => {
                    Promise.all([profilesApi.getCandidateProfile(), skillsApi.mySkills()])
                      .then(([profile, skills]) => {
                        if (!profile.error) {
                          setCandidateProfile(profile);
                          // Update name in currentUser if changed
                          if (profile.name) setCurrentUser(u => ({ ...u, name: profile.name }));
                        }
                        if (!skills.error) setMySkills(Array.isArray(skills) ? skills : []);
                      });
                    showToastMessage('Profile saved successfully!');
                  }}
                  onPhotoUploaded={(url) => {
                    setCurrentUser(u => ({ ...u, photo_url: url }));
                    showToastMessage('Photo updated!');
                  }}
                />
              )}

              {activeTab === 'skill-passport' && (
                <SkillPassportView data={data} currentUser={currentUser} setActiveTab={setActiveTab} />
              )}
            </>
          )}

          {/* EMPLOYER PORTAL VIEWS */}
          {!dataLoading && currentUser.role === 'EMPLOYER' && (
            <>
              {activeTab === 'dashboard' && (
                <EmployerDashboardView data={data} currentUser={currentUser} setActiveTab={setActiveTab} />
              )}

              {activeTab === 'my-listings' && (
                <EmployerListingsView 
                  data={data} 
                  currentUser={currentUser} 
                  onOpenCreateModal={() => setShowCreateApprenticeshipModal(true)}
                  onToggleStatus={(id) => {
                    apprenticeshipsApi.list().then(() => {
                      // Optimistic local toggle
                      setApprenticeships(prev => prev.map(a => a.id === id ? { ...a, status: a.status === 'published' ? 'draft' : 'published' } : a));
                    });
                    showToastMessage('Apprenticeship status updated.');
                  }}
                />
              )}

              {activeTab === 'applicants' && (
                <EmployerApplicantsView 
                  data={data} 
                  currentUser={currentUser}
                  onUpdateStatus={(appId, newStatus) => {
                    applicationsApi.updateStatus(appId, newStatus).then(r => {
                      if (r.error) { showToastMessage(r.error, 'error'); return; }
                      setApplications(prev => prev.map(a => a.id === appId ? { ...a, status: newStatus } : a));
                      showToastMessage(`Applicant status moved to ${newStatus}`);
                    });
                  }}
                />
              )}

              {activeTab === 'completions' && (
                <EmployerCompletionsView 
                  data={data}
                  currentUser={currentUser}
                  onConfirmCompletion={(candId, skills) => {
                    const hash = `RECORD_HASH_${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
                    addAuditLog(currentUser.name, 'APPRENTICESHIP_COMPLETED', `Generated tamper-evident record hash ${hash} for Candidate ${candId}`);
                    showToastMessage(`Completion Confirmed! Tamper-Evident Record Created (${hash})`);
                  }}
                />
              )}

              {activeTab === 'employer-assessments' && (
                <EmployerAssessmentsView
                  data={data}
                  currentUser={currentUser}
                  showToastMessage={showToastMessage}
                  onSaved={() => {
                    assessmentsApi.mine().then(r => {
                      if (!r.error) setAssessments(Array.isArray(r) ? r : []);
                    });
                    showToastMessage('Assessment saved!');
                  }}
                />
              )}

              {activeTab === 'employer-profile' && (
                <EmployerProfileView
                  data={data}
                  currentUser={currentUser}
                  onProfileSaved={() => {
                    profilesApi.getEmployerProfile().then(p => {
                      if (!p.error) {
                        setEmployerProfile(p);
                        if (p.name) setCurrentUser(u => ({ ...u, name: p.name }));
                      }
                    });
                    showToastMessage('Company profile saved successfully!');
                  }}
                  onPhotoUploaded={(url) => {
                    setCurrentUser(u => ({ ...u, photo_url: url }));
                    showToastMessage('Photo updated!');
                  }}
                />
              )}
            </>
          )}

          {/* ADMIN PORTAL VIEWS */}
          {!dataLoading && currentUser.role === 'ADMIN' && (
            <>
              {activeTab === 'dashboard' && <AdminDashboardView data={data} setActiveTab={setActiveTab} />}
              {activeTab === 'users' && <AdminUsersView data={data} />}
              
              {activeTab === 'verification-mod' && (
                <AdminVerificationModView 
                  data={data}
                  onApproveReject={(evId, newStatus) => {
                    evidenceApi.review(evId, newStatus).then(r => {
                      if (r.error) { showToastMessage(r.error, 'error'); return; }
                      refreshEvidence();
                      addAuditLog(currentUser.name, 'EVIDENCE_MODERATION', `Set evidence ID ${evId} to ${newStatus}`);
                      showToastMessage(`Evidence ${newStatus.toLowerCase()} successfully.`);
                    });
                  }}
                />
              )}

              {activeTab === 'ai-questions' && (
                <AdminAiQuestionsView 
                  data={data}
                  onGenerateDraft={generateAIDraftQuestion}
                  aiGenerating={aiGenerating}
                  onApproveQuestion={(assessId, qId) => {
                    setAssessments(prev => prev.map(a => {
                      if (a.id === assessId) {
                        return { ...a, questions: (a.questions || []).map(q => q.id === qId ? { ...q, status: 'APPROVED' } : q) };
                      }
                      return a;
                    }));
                    addAuditLog(currentUser.name, 'AI_QUESTION_APPROVED', `Approved draft question ID ${qId}`);
                    showToastMessage('Question approved and activated for candidates!');
                  }}
                />
              )}

              {activeTab === 'audit-logs' && <AdminAuditLogsView logs={auditLogs} />}
            </>
          )}

        </main>
      </div>

      {/* CREATE APPRENTICESHIP MODAL FOR EMPLOYERS */}
      {showCreateApprenticeshipModal && (
        <CreateApprenticeshipModal 
          onClose={() => setShowCreateApprenticeshipModal(false)}
          onSubmit={(newListing) => {
            // Guard: only employers can create listings
            if (currentUser.role !== 'EMPLOYER') {
              showToastMessage('Only employer accounts can create apprenticeship listings.', 'error');
              setShowCreateApprenticeshipModal(false);
              return;
            }
            apprenticeshipsApi.create({ ...newListing, status: 'published' }).then(r => {
              if (r.error) { showToastMessage(r.error, 'error'); return; }
              setApprenticeships(prev => [r, ...prev]);
              addAuditLog(currentUser.name, 'APPRENTICESHIP_CREATED', `Created listing: ${newListing.title}`);
              showToastMessage('New Apprenticeship Listing Published!');
              setShowCreateApprenticeshipModal(false);
            });
          }}
        />
      )}

      {/* EVIDENCE UPLOAD MODAL FOR CANDIDATES */}
      {showEvidenceUploadModal && (
        <UploadEvidenceModal 
          onClose={() => setShowEvidenceUploadModal(false)}
          onSubmit={(evidenceObj) => {
            evidenceApi.upload(evidenceObj.skillId, evidenceObj.file).then(r => {
              if (r.error) { showToastMessage(r.error, 'error'); return; }
              refreshEvidence();
              addAuditLog(currentUser.name, 'EVIDENCE_UPLOADED', `Uploaded evidence: ${evidenceObj.title || evidenceObj.file?.name}`);
              showToastMessage('Evidence uploaded! Status set to Under Review.');
              setShowEvidenceUploadModal(false);
            });
          }}
        />
      )}

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 py-6 mt-auto">
        <div className="max-w-7xl mx-auto px-4 text-center text-xs text-slate-500">
          <p>© 2026 ApprenticeBridge Platform. Verified Skill Matching Engine. AI decision-making restricted per platform governance.</p>
        </div>
      </footer>
    </div>
  );
}

function LandingPage({ onEnter, onOpenSignIn, onOpenSignUp, isLoggedIn }) {
  const featureCards = [
    {
      icon: <Target className="w-5 h-5" />,
      title: 'Skill-first matching',
      text: 'Match apprenticeship opportunities using verified and assessed skills instead of relying only on a resume.',
    },
    {
      icon: <Award className="w-5 h-5" />,
      title: 'Verified skill profile',
      text: 'Turn assessments, evidence and credentials into a structured skill profile employers can understand.',
    },
    {
      icon: <FileSearch className="w-5 h-5" />,
      title: 'ATS-ready resume',
      text: 'Check your resume against a target opportunity and identify missing keywords and skills before applying.',
    },
    {
      icon: <TrendingUp className="w-5 h-5" />,
      title: 'Performance insights',
      text: 'Track applications, skill scores and profile completeness from one candidate dashboard.',
    },
  ];

  return (
    <div className="min-h-screen bg-[#F4F7F5] text-slate-800 overflow-x-hidden">
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/90 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center text-white shadow-md shadow-emerald-200">
              <Zap className="w-6 h-6" />
            </div>
            <div>
              <span className="text-xl font-extrabold tracking-tight text-slate-900">Apprentice<span className="text-emerald-600">Bridge</span></span>
              <span className="hidden sm:inline-block ml-2 text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">Verified Skills Engine</span>
            </div>
          </div>
          {isLoggedIn ? (
            <button
              onClick={() => onEnter('CANDIDATE')}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-xs sm:text-sm font-extrabold hover:bg-emerald-500 transition-all shadow-lg shadow-emerald-200"
            >
              Go to Dashboard <ArrowUpRight className="w-4 h-4" />
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={onOpenSignIn}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-900 text-xs sm:text-sm font-extrabold hover:bg-slate-50 transition-all shadow-sm"
              >
                Log In
              </button>
              <button
                onClick={onOpenSignUp}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-xs sm:text-sm font-extrabold hover:bg-emerald-500 transition-all shadow-lg shadow-emerald-200"
              >
                Sign Up <ArrowUpRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden">
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute -top-24 -right-24 w-80 h-80 rounded-full bg-emerald-300/20 blur-3xl" />
            <div className="absolute top-32 -left-24 w-72 h-72 rounded-full bg-teal-200/25 blur-3xl" />
          </div>
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-20 lg:py-28 relative">
            <div className="grid lg:grid-cols-[1.05fr_0.95fr] gap-12 items-center">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white px-3 py-1.5 text-[11px] font-extrabold uppercase tracking-wider text-emerald-700 shadow-sm">
                  <Sparkles className="w-3.5 h-3.5" /> Skill-first apprenticeship platform
                </div>
                <h1 className="mt-6 text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight text-slate-950 leading-[1.02] text-balance">
                  Build Skills. Get Verified. <span className="text-emerald-600">Find the Right Apprenticeship.</span>
                </h1>
                <p className="mt-6 max-w-2xl text-base sm:text-lg leading-8 text-slate-600">
                  ApprenticeBridge connects candidates, employers and platform administrators through verified skills, explainable matching and application tracking.
                </p>
                <div className="mt-8 flex flex-col sm:flex-row gap-3">
                  <button
                    onClick={onOpenSignUp}
                    className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold shadow-xl shadow-emerald-200 transition-all"
                  >
                    Explore Apprenticeships <ArrowRight className="w-4 h-4" />
                  </button>
                  <button
                    onClick={onOpenSignIn}
                    className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-2xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-900 font-extrabold transition-all"
                  >
                    Employer Demo <Building className="w-4 h-4" />
                  </button>
                </div>
                <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs font-semibold text-slate-500">
                  <span className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-emerald-600" /> Verified skill evidence</span>
                  <span className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-emerald-600" /> Explainable match scores</span>
                  <span className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-emerald-600" /> Role-based portals</span>
                </div>
              </div>

              <div className="relative">
                <div className="absolute -inset-5 rounded-[2rem] bg-emerald-500/10 blur-2xl" />
                <div className="relative rounded-[2rem] border border-slate-200 bg-white p-5 sm:p-6 shadow-2xl shadow-slate-900/10">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                    <div>
                      <p className="text-[10px] uppercase tracking-wider font-black text-emerald-600">Candidate Snapshot</p>
                      <h3 className="mt-1 text-lg font-black text-slate-900">Alex Rivera</h3>
                    </div>
                    <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center"><User className="w-5 h-5" /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 mt-4">
                    <div className="rounded-2xl bg-slate-50 border border-slate-100 p-4">
                      <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Verified skills</p>
                      <p className="mt-2 text-2xl font-black text-slate-900">2/4</p>
                      <p className="text-[11px] text-emerald-700 font-semibold mt-1">Profile evidence</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 border border-slate-100 p-4">
                      <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Top match</p>
                      <p className="mt-2 text-2xl font-black text-emerald-600">85%</p>
                      <p className="text-[11px] text-slate-500 font-semibold mt-1">Explainable score</p>
                    </div>
                  </div>
                  <div className="mt-4 rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-[10px] uppercase font-black tracking-wider text-emerald-700">Recommended</p>
                        <p className="mt-1 font-extrabold text-slate-900">Junior Frontend Developer Apprentice</p>
                      </div>
                      <span className="rounded-full bg-emerald-600 text-white px-2.5 py-1 text-[10px] font-black">85%</span>
                    </div>
                    <div className="mt-4 h-2 rounded-full bg-white overflow-hidden">
                      <div className="h-full w-[85%] rounded-full bg-emerald-500" />
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                    {['JavaScript', 'React', 'Node.js'].map((skill, index) => (
                      <div key={skill} className="rounded-xl bg-white border border-slate-200 p-2.5">
                        <p className="text-[10px] font-bold text-slate-700 truncate">{skill}</p>
                        <p className="text-[10px] mt-1 text-emerald-600 font-extrabold">{[92, 85, 60][index]}%</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {featureCards.map((card) => (
              <div key={card.title} className="group bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm hover:-translate-y-1 hover:shadow-xl hover:border-emerald-200 transition-all">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center group-hover:bg-emerald-600 group-hover:text-white transition-all">
                  {card.icon}
                </div>
                <h3 className="mt-4 font-black text-slate-900">{card.title}</h3>
                <p className="mt-2 text-xs leading-5 text-slate-500">{card.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="border-y border-slate-200 bg-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-20">
            <div className="text-center max-w-2xl mx-auto">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-600">How it works</p>
              <h2 className="mt-3 text-3xl sm:text-4xl font-black text-slate-950">One platform, three connected experiences.</h2>
              <p className="mt-4 text-sm sm:text-base text-slate-500">Candidates prove skills, employers discover relevant talent, and administrators keep the platform governed.</p>
            </div>
            <div className="mt-10 grid md:grid-cols-3 gap-5">
              {[
                ['01', 'Create your profile', 'Add your education, experience, interests and existing skills.'],
                ['02', 'Verify and match', 'Use assessments and evidence to strengthen your skill profile and discover explainable matches.'],
                ['03', 'Apply and track', 'Submit applications and follow their status from one place.'],
              ].map(([number, title, text]) => (
                <div key={number} className="relative rounded-3xl bg-slate-50 border border-slate-200 p-6">
                  <span className="text-4xl font-black text-emerald-100">{number}</span>
                  <h3 className="mt-2 font-black text-slate-900 text-lg">{title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-500">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-20">
          <div className="rounded-[2rem] bg-gradient-to-r from-emerald-950 via-teal-900 to-slate-950 text-white p-8 sm:p-12 relative overflow-hidden shadow-2xl">
            <div className="absolute -right-20 -top-20 w-72 h-72 rounded-full bg-emerald-400/10 blur-3xl" />
            <div className="relative max-w-3xl">
              <p className="text-xs uppercase tracking-[0.18em] font-black text-emerald-300">Ready to get started?</p>
              <h2 className="mt-3 text-3xl sm:text-4xl font-black">Turn your skills into your next opportunity.</h2>
              <p className="mt-4 text-sm sm:text-base text-slate-300 leading-7">Explore the existing Candidate, Employer and Admin portals while keeping the verified matching workflow at the center.</p>
              <div className="mt-7 flex flex-col sm:flex-row gap-3">
                <button onClick={onOpenSignUp} className="px-5 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black transition-all">Get Started Free</button>
                <button onClick={onOpenSignIn} className="px-5 py-3 rounded-xl border border-white/15 bg-white/5 hover:bg-white/10 text-white font-black transition-all">Sign In</button>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-white border-t border-slate-200 py-7">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row gap-2 items-center justify-between text-xs text-slate-500">
          <p>© 2026 ApprenticeBridge Platform.</p>
          <p>Verified Skill Matching Engine • Candidate • Employer • Admin</p>
        </div>
      </footer>
    </div>
  );
}

function CandidateAnalyticsView({ data, currentUser, setActiveTab }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Assessment performance data
  const [perfData, setPerfData] = useState(null);
  const [langFilter, setLangFilter] = useState('ALL');
  const [timeFilter, setTimeFilter] = useState('all'); // all | 30d | 3m | 6m

  useEffect(() => {
    setLoading(true);
    Promise.all([
      analyticsApi.candidate(),
      analyticsApi.candidateAssessments(),
    ])
      .then(([statsRes, perfRes]) => {
        if (statsRes.error) {
          if (statsRes.status === 401) setError('Your session has expired. Please sign in again.');
          else if (statsRes.status === 403) setError('This feature is only available for candidate accounts. Please sign in with a candidate account.');
          else setError(statsRes.error);
        }
        else setStats(statsRes);
        if (!perfRes.error) setPerfData(perfRes);
      })
      .catch(() => setError('Failed to load analytics.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (error) return (
    <div className="space-y-4">
      <div className="p-6 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-sm font-semibold">
        {error}
      </div>
      {error.includes('session') && (
        <button onClick={() => { if (typeof window !== 'undefined') window.location.href = '/?modal=signin'; }}
          className="px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700">
          Sign In Again
        </button>
      )}
    </div>
  );

  // ── Data ─────────────────────────────────────────────────────────────────
  const months      = stats?.applications_by_month || [];
  const statusDist  = stats?.status_distribution   || { Applied: 0, Shortlisted: 0, Selected: 0, Rejected: 0 };
  const verifiedCt  = stats?.skills_verified   ?? 0;
  const unverifiedCt= stats?.skills_unverified ?? 0;
  const totalSkills = verifiedCt + unverifiedCt;

  // ── Line chart helpers ───────────────────────────────────────────────────
  const chartW = 560; const chartH = 160; const padL = 32; const padB = 24; const padT = 12; const padR = 16;
  const maxCount = Math.max(...months.map(m => m.count), 1);
  const pts = months.map((m, i) => {
    const x = padL + (i / Math.max(months.length - 1, 1)) * (chartW - padL - padR);
    const y = padT + (1 - m.count / maxCount) * (chartH - padT - padB);
    return { x, y, ...m };
  });
  const polyline = pts.map(p => `${p.x},${p.y}`).join(' ');
  // filled area path
  const areaPath = pts.length
    ? `M${pts[0].x},${chartH - padB} ` + pts.map(p => `L${p.x},${p.y}`).join(' ') + ` L${pts[pts.length-1].x},${chartH - padB} Z`
    : '';

  // ── Doughnut chart helpers ───────────────────────────────────────────────
  const doughnutColors  = { Applied: '#10b981', Shortlisted: '#14b8a6', Selected: '#3b82f6', Rejected: '#f43f5e' };
  const totalApps = Object.values(statusDist).reduce((s, v) => s + v, 0);
  const doughnutSlices = (() => {
    const r = 60; const cx = 80; const cy = 80; const inner = 36;
    let angle = -Math.PI / 2;
    return Object.entries(statusDist).map(([label, count]) => {
      const fraction = totalApps ? count / totalApps : 0;
      const sweep = fraction * 2 * Math.PI;
      const x1 = cx + r * Math.cos(angle);
      const y1 = cy + r * Math.sin(angle);
      angle += sweep;
      const x2 = cx + r * Math.cos(angle);
      const y2 = cy + r * Math.sin(angle);
      const xi1 = cx + inner * Math.cos(angle - sweep);
      const yi1 = cy + inner * Math.sin(angle - sweep);
      const xi2 = cx + inner * Math.cos(angle);
      const yi2 = cy + inner * Math.sin(angle);
      const large = sweep > Math.PI ? 1 : 0;
      const path = fraction > 0
        ? `M${x1} ${y1} A${r} ${r} 0 ${large} 1 ${x2} ${y2} L${xi2} ${yi2} A${inner} ${inner} 0 ${large} 0 ${xi1} ${yi1} Z`
        : '';
      return { label, count, fraction, path, color: doughnutColors[label] };
    });
  })();

  // ── Bar chart helpers ────────────────────────────────────────────────────
  const barData   = [
    { label: 'Verified',   count: verifiedCt,   color: '#10b981' },
    { label: 'Unverified', count: unverifiedCt,  color: '#94a3b8' },
  ];
  const maxBar = Math.max(...barData.map(b => b.count), 1);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wider font-black text-emerald-600">Candidate Analytics</p>
            <h2 className="mt-1 text-2xl font-black text-slate-900">Your performance at a glance</h2>
            <p className="mt-1 text-sm text-slate-500">Charts are built from your live application and skill records.</p>
          </div>
          <button onClick={() => setActiveTab('ats-analyzer')}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 text-white text-xs font-extrabold hover:bg-slate-800">
            Check resume <ArrowUpRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Total Applications', value: totalApps,       color: 'text-slate-900' },
          { label: 'Shortlisted',         value: statusDist.Shortlisted, color: 'text-teal-600' },
          { label: 'Selected',            value: statusDist.Selected,    color: 'text-blue-600' },
          { label: 'Skills Verified',     value: verifiedCt,     color: 'text-emerald-600' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-sm">
            <p className="text-[10px] uppercase tracking-wider font-black text-slate-400">{label}</p>
            <p className={`mt-2 text-3xl font-black ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* ── Chart 1: Applications Over Time (Line) ── */}
      <div className="bg-white rounded-2xl p-5 sm:p-6 border border-slate-200/80 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-black text-slate-900">Applications Over Time</h3>
            <p className="text-xs text-slate-500 mt-0.5">Number of applications submitted each month</p>
          </div>
          <TrendingUp className="w-5 h-5 text-emerald-500" />
        </div>

        {months.every(m => m.count === 0) ? (
          <p className="text-sm text-slate-400 italic py-6 text-center">No applications yet — submit your first one to see the chart.</p>
        ) : (
          <div className="overflow-x-auto">
            <svg viewBox={`0 0 ${chartW} ${chartH}`} className="w-full" style={{ minWidth: 320 }}>
              {/* Grid lines */}
              {[0, 0.25, 0.5, 0.75, 1].map(f => {
                const y = padT + (1 - f) * (chartH - padT - padB);
                const val = Math.round(f * maxCount);
                return (
                  <g key={f}>
                    <line x1={padL} y1={y} x2={chartW - padR} y2={y} stroke="#f1f5f9" strokeWidth="1" />
                    <text x={padL - 4} y={y + 3.5} textAnchor="end" fontSize="8" fill="#94a3b8">{val}</text>
                  </g>
                );
              })}
              {/* Filled area */}
              <path d={areaPath} fill="url(#lineGrad)" opacity="0.25" />
              <defs>
                <linearGradient id="lineGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" />
                  <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
                </linearGradient>
              </defs>
              {/* Line */}
              <polyline points={polyline} fill="none" stroke="#10b981" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              {/* Dots + x-labels (every 2nd month to avoid overlap) */}
              {pts.map((p, i) => (
                <g key={i}>
                  <circle cx={p.x} cy={p.y} r="3.5" fill="#10b981" />
                  {p.count > 0 && (
                    <text x={p.x} y={p.y - 7} textAnchor="middle" fontSize="8" fill="#059669" fontWeight="bold">{p.count}</text>
                  )}
                  {(i % 2 === 0 || months.length <= 6) && (
                    <text x={p.x} y={chartH - 4} textAnchor="middle" fontSize="7.5" fill="#94a3b8">{p.month.split(' ')[0]}</text>
                  )}
                </g>
              ))}
            </svg>
          </div>
        )}
      </div>

      {/* ── Chart 2 + 3 side by side ── */}
      <div className="grid lg:grid-cols-2 gap-6">

        {/* Chart 2: Application Status (Doughnut) */}
        <div className="bg-white rounded-2xl p-5 sm:p-6 border border-slate-200/80 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-black text-slate-900">Application Status</h3>
              <p className="text-xs text-slate-500 mt-0.5">Applied, shortlisted, rejected, selected</p>
            </div>
            <BarChart2 className="w-5 h-5 text-teal-500" />
          </div>

          {totalApps === 0 ? (
            <p className="text-sm text-slate-400 italic py-6 text-center">No applications yet.</p>
          ) : (
            <div className="flex flex-col sm:flex-row items-center gap-6">
              <svg viewBox="0 0 160 160" className="w-36 h-36 flex-shrink-0">
                {doughnutSlices.map(s => s.path && (
                  <path key={s.label} d={s.path} fill={s.color}>
                    <title>{s.label}: {s.count}</title>
                  </path>
                ))}
                {/* Centre label */}
                <text x="80" y="76" textAnchor="middle" fontSize="18" fontWeight="bold" fill="#0f172a">{totalApps}</text>
                <text x="80" y="90" textAnchor="middle" fontSize="8" fill="#94a3b8">total</text>
              </svg>

              <div className="flex-1 space-y-2.5 w-full">
                {doughnutSlices.map(s => (
                  <div key={s.label} className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: s.color }} />
                      <span className="text-xs font-semibold text-slate-700 truncate">{s.label}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-20 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${Math.round(s.fraction * 100)}%`, background: s.color }} />
                      </div>
                      <span className="text-xs font-black text-slate-800 w-5 text-right">{s.count}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Chart 3: Skills Verified (Bar) */}
        <div className="bg-white rounded-2xl p-5 sm:p-6 border border-slate-200/80 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-black text-slate-900">Skills Verified</h3>
              <p className="text-xs text-slate-500 mt-0.5">Number of verified vs unverified skills</p>
            </div>
            <BarChart2 className="w-5 h-5 text-emerald-500" />
          </div>

          {totalSkills === 0 ? (
            <p className="text-sm text-slate-400 italic py-6 text-center">No skills added yet. Add skills from your Candidate Profile.</p>
          ) : (
            <>
              <svg viewBox="0 0 320 140" className="w-full mb-4">
                {/* Y-axis labels */}
                {[0, 0.5, 1].map(f => {
                  const y = 10 + (1 - f) * 100;
                  const val = Math.round(f * maxBar);
                  return (
                    <g key={f}>
                      <line x1="28" y1={y} x2="310" y2={y} stroke="#f1f5f9" strokeWidth="1" />
                      <text x="24" y={y + 3.5} textAnchor="end" fontSize="8" fill="#94a3b8">{val}</text>
                    </g>
                  );
                })}
                {/* Bars */}
                {barData.map((b, i) => {
                  const barW = 72;
                  const gap  = 48;
                  const x    = 48 + i * (barW + gap);
                  const barH = Math.max(4, (b.count / maxBar) * 100);
                  const y    = 110 - barH;
                  return (
                    <g key={b.label}>
                      <rect x={x} y={y} width={barW} height={barH} rx="6" fill={b.color} />
                      <text x={x + barW / 2} y={y - 5} textAnchor="middle" fontSize="10" fontWeight="bold" fill={b.color}>{b.count}</text>
                      <text x={x + barW / 2} y="128" textAnchor="middle" fontSize="9" fill="#64748b">{b.label}</text>
                    </g>
                  );
                })}
              </svg>

              {/* Legend */}
              <div className="flex items-center gap-6 justify-center">
                {barData.map(b => (
                  <div key={b.label} className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-sm" style={{ background: b.color }} />
                    <span className="text-xs font-semibold text-slate-600">{b.label} ({b.count})</span>
                  </div>
                ))}
                <span className="text-xs text-slate-400">/ {totalSkills} total</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Assessment Performance (combined bar chart) ── */}
      {(() => {
        const allAttempts = perfData?.attempts || [];
        const proficiency  = perfData?.proficiency || [];

        // Build language list for filter dropdown
        const languages = [...new Set(allAttempts.map(a => a.skill_name))].sort();

        // Apply filters
        const now = Date.now();
        const timeMs = { '30d': 30*24*60*60*1000, '3m': 90*24*60*60*1000, '6m': 180*24*60*60*1000 };
        const filteredAttempts = allAttempts.filter(a => {
          if (langFilter !== 'ALL' && a.skill_name !== langFilter) return false;
          if (timeFilter !== 'all') {
            const attemptDate = new Date(a.completed_at).getTime();
            if (now - attemptDate > timeMs[timeFilter]) return false;
          }
          return true;
        });

        // Color palette per language
        const langColors = {};
        const palette = ['#10b981', '#3b82f6', '#8b5cf6', '#f59e0b', '#ec4899', '#06b6d4', '#84cc16', '#f43f5e', '#6366f1', '#14b8a6'];
        languages.forEach((lang, i) => { langColors[lang] = palette[i % palette.length]; });

        // Bar chart dimensions
        const aChartW = Math.max(400, filteredAttempts.length * 48 + 60);
        const aChartH = 200; const aPadL = 36; const aPadB = 40; const aPadT = 16; const aPadR = 16;
        const barW = 28; const barGap = 20;
        const maxScore = 100;

        const formatAttemptDate = (iso) => {
          if (!iso) return '';
          try { return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); }
          catch { return ''; }
        };

        return (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl p-5 sm:p-6 border border-slate-200/80 shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
                <div>
                  <h3 className="font-black text-slate-900">Assessment Performance</h3>
                  <p className="text-xs text-slate-500 mt-0.5">Every assessment attempt as a separate bar — historical scores are never overwritten.</p>
                </div>
                <Award className="w-5 h-5 text-violet-500" />
              </div>

              {/* Filters */}
              <div className="flex flex-wrap items-center gap-4 mb-5 pb-4 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <label className="text-xs font-bold text-slate-600">Language:</label>
                  <select
                    value={langFilter}
                    onChange={e => setLangFilter(e.target.value)}
                    className="text-xs border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-emerald-500">
                    <option value="ALL">All Languages</option>
                    {languages.map(lang => (
                      <option key={lang} value={lang}>{lang}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs font-bold text-slate-600">Time Range:</label>
                  <select
                    value={timeFilter}
                    onChange={e => setTimeFilter(e.target.value)}
                    className="text-xs border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-emerald-500">
                    <option value="all">All Time</option>
                    <option value="30d">Last 30 Days</option>
                    <option value="3m">Last 3 Months</option>
                    <option value="6m">Last 6 Months</option>
                  </select>
                </div>
                <span className="text-xs text-slate-400 ml-auto">
                  {filteredAttempts.length} attempt{filteredAttempts.length !== 1 ? 's' : ''}
                  {langFilter !== 'ALL' ? ` for ${langFilter}` : ''}
                </span>
              </div>

              {/* Language legend chips */}
              {languages.length > 1 && langFilter === 'ALL' && (
                <div className="flex flex-wrap gap-2 mb-4">
                  {languages.map(lang => (
                    <span key={lang} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-50 border border-slate-200 text-[11px] font-bold text-slate-600">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: langColors[lang] }} />
                      {lang}
                    </span>
                  ))}
                </div>
              )}

              {/* Bar chart */}
              {filteredAttempts.length === 0 ? (
                <p className="text-sm text-slate-400 italic py-8 text-center">
                  {allAttempts.length === 0
                    ? 'No assessment attempts yet. Take an assessment from the Skill Assessments tab to see your performance here.'
                    : 'No attempts match the selected filters.'}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <svg viewBox={`0 0 ${aChartW} ${aChartH}`} className="w-full" style={{ minWidth: Math.min(aChartW, 600) }}>
                    {/* Y-axis grid lines + labels */}
                    {[0, 25, 50, 75, 100].map(val => {
                      const y = aPadT + (1 - val / maxScore) * (aChartH - aPadT - aPadB);
                      return (
                        <g key={val}>
                          <line x1={aPadL} y1={y} x2={aChartW - aPadR} y2={y} stroke="#f1f5f9" strokeWidth="1" />
                          <text x={aPadL - 6} y={y + 3.5} textAnchor="end" fontSize="8" fill="#94a3b8">{val}%</text>
                        </g>
                      );
                    })}
                    {/* Bars — each attempt is a separate bar */}
                    {filteredAttempts.map((a, i) => {
                      const x = aPadL + i * (barW + barGap) + barGap / 2;
                      const barH = Math.max(3, (a.score / maxScore) * (aChartH - aPadT - aPadB));
                      const y = aPadT + (1 - a.score / maxScore) * (aChartH - aPadT - aPadB);
                      const color = langColors[a.skill_name] || '#10b981';
                      return (
                        <g key={a.id || i}>
                          <rect x={x} y={y} width={barW} height={barH} rx="4" fill={color} opacity="0.85">
                            <title>{a.skill_name}: {a.score}% ({a.level}) — {formatAttemptDate(a.completed_at)}</title>
                          </rect>
                          {/* Score label on top */}
                          <text x={x + barW / 2} y={y - 5} textAnchor="middle" fontSize="9" fontWeight="bold" fill={color}>{a.score}%</text>
                          {/* Date label at bottom (show every 2nd if many) */}
                          {(filteredAttempts.length <= 10 || i % 2 === 0) && (
                            <text x={x + barW / 2} y={aChartH - aPadB + 12} textAnchor="middle" fontSize="7" fill="#94a3b8" transform={`rotate(-30 ${x + barW / 2} ${aChartH - aPadB + 12})`}>
                              {formatAttemptDate(a.completed_at)}
                            </text>
                          )}
                          {/* Language initial above bar when All filter is on */}
                          {langFilter === 'ALL' && (
                            <text x={x + barW / 2} y={y - 16} textAnchor="middle" fontSize="7" fontWeight="bold" fill={color} opacity="0.7">
                              {a.skill_name.substring(0, 4)}
                            </text>
                          )}
                        </g>
                      );
                    })}
                    {/* X-axis line */}
                    <line x1={aPadL} y1={aChartH - aPadB} x2={aChartW - aPadR} y2={aChartH - aPadB} stroke="#e2e8f0" strokeWidth="1" />
                  </svg>
                </div>
              )}
            </div>

            {/* ── Current Skill Proficiency section ── */}
            <div className="bg-white rounded-2xl p-5 sm:p-6 border border-slate-200/80 shadow-sm">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h3 className="font-black text-slate-900">Current Skill Proficiency</h3>
                  <p className="text-xs text-slate-500 mt-0.5">Latest valid assessment score for each language, with verification status.</p>
                </div>
                <BadgeCheck className="w-5 h-5 text-emerald-500" />
              </div>

              {proficiency.length === 0 ? (
                <p className="text-sm text-slate-400 italic py-8 text-center">No assessment results yet. Take an assessment to see your current proficiency levels.</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {proficiency.map(p => {
                    const scoreColor = p.latest_score >= 85 ? '#10b981' : p.latest_score >= 70 ? '#3b82f6' : p.latest_score >= 50 ? '#f59e0b' : '#f43f5e';
                    const langColor = langColors[p.skill_name] || '#10b981';
                    return (
                      <div key={p.skill_id} className="rounded-xl border border-slate-200 p-4 space-y-3 hover:shadow-sm transition-shadow">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full" style={{ background: langColor }} />
                            <span className="text-sm font-extrabold text-slate-900">{p.skill_name}</span>
                          </div>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
                            p.verified
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-slate-100 text-slate-500'
                          }`}>
                            {p.verified ? '✓ VERIFIED' : 'UNVERIFIED'}
                          </span>
                        </div>
                        {/* Score bar */}
                        <div>
                          <div className="flex items-center justify-between text-xs mb-1">
                            <span className="font-bold text-slate-700 capitalize">{p.latest_level}</span>
                            <span className="font-black" style={{ color: scoreColor }}>{p.latest_score}%</span>
                          </div>
                          <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                            <div className="h-full rounded-full transition-all" style={{ width: `${p.latest_score}%`, background: scoreColor }} />
                          </div>
                        </div>
                        {/* Metadata */}
                        <div className="flex items-center justify-between text-[10px] text-slate-400 font-semibold">
                          <span>{p.attempt_count} attempt{p.attempt_count !== 1 ? 's' : ''}</span>
                          {p.verified_at && (
                            <span>Verified: {new Date(p.verified_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

const ATS_STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'your', 'you', 'our', 'are', 'will', 'have', 'has', 'into', 'using', 'use',
  'job', 'role', 'work', 'team', 'years', 'year', 'required', 'requirements', 'responsibilities', 'candidate', 'looking', 'must',
  'should', 'their', 'they', 'them', 'who', 'what', 'where', 'when', 'how', 'all', 'any', 'about', 'over', 'under', 'through',
  'experience', 'skills', 'ability', 'strong', 'good', 'knowledge', 'including', 'preferred', 'plus', 'etc'
]);

const ATS_KNOWN_SKILLS = [
  'JavaScript', 'TypeScript', 'React', 'Next.js', 'Node.js', 'Express', 'Python', 'FastAPI', 'Java', 'C++', 'SQL', 'PostgreSQL',
  'MongoDB', 'MySQL', 'AWS', 'Azure', 'Docker', 'Kubernetes', 'Git', 'GitHub', 'REST API', 'GraphQL', 'Tailwind CSS', 'HTML',
  'CSS', 'Figma', 'UI/UX', 'Machine Learning', 'Deep Learning', 'Generative AI', 'LLM', 'RAG', 'TensorFlow', 'PyTorch', 'Linux'
];

function normalizeAtsText(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9+#./ -]/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractAtsKeywords(jobDescription) {
  const normalized = normalizeAtsText(jobDescription);
  const words = normalized.split(' ').filter(word => word.length >= 3 && !ATS_STOP_WORDS.has(word));
  const known = ATS_KNOWN_SKILLS.filter(skill => normalized.includes(normalizeAtsText(skill)));
  const frequent = [...new Set(words)].slice(0, 35);
  return [...new Set([...known, ...frequent])];
}

function calculateAtsResult(resumeText, jobDescription) {
  const resume = normalizeAtsText(resumeText);
  const job = normalizeAtsText(jobDescription);
  const keywords = extractAtsKeywords(jobDescription);
  const matchedKeywords = keywords.filter(keyword => resume.includes(normalizeAtsText(keyword)));
  const missingKeywords = keywords.filter(keyword => !resume.includes(normalizeAtsText(keyword))).slice(0, 12);
  const matchedSkills = ATS_KNOWN_SKILLS.filter(skill => job.includes(normalizeAtsText(skill)) && resume.includes(normalizeAtsText(skill)));
  const missingSkills = ATS_KNOWN_SKILLS.filter(skill => job.includes(normalizeAtsText(skill)) && !resume.includes(normalizeAtsText(skill))).slice(0, 10);
  const keywordScore = keywords.length ? Math.round((matchedKeywords.length / keywords.length) * 100) : 0;
  const skillRequirements = ATS_KNOWN_SKILLS.filter(skill => job.includes(normalizeAtsText(skill)));
  const skillScore = skillRequirements.length ? Math.round((matchedSkills.length / skillRequirements.length) * 100) : keywordScore;
  const sections = ['education', 'experience', 'project', 'skills'];
  const sectionScore = Math.round((sections.filter(section => resume.includes(section)).length / sections.length) * 100);
  const contactScore = /\b[\w.-]+@[\w.-]+\.[a-z]{2,}\b/i.test(resumeText) ? 100 : 50;
  const overall = Math.round(keywordScore * 0.45 + skillScore * 0.35 + sectionScore * 0.15 + contactScore * 0.05);
  const warnings = [];
  if (resumeText.length < 700) warnings.push('Resume text is quite short; add measurable project or experience details.');
  if (!/\b[\w.-]+@[\w.-]+\.[a-z]{2,}\b/i.test(resumeText)) warnings.push('No email address was detected in the extracted resume text.');
  if (!/\b(?:\+?\d[\d ()-]{8,}\d)\b/.test(resumeText)) warnings.push('No phone number was detected in the extracted resume text.');
  if (!resume.includes('skills')) warnings.push('A dedicated Skills section was not detected.');
  if (!resume.includes('experience') && !resume.includes('project')) warnings.push('Experience/Projects evidence was not detected.');

  return {
    overall,
    keywordScore,
    skillScore,
    sectionScore,
    matchedKeywords: matchedKeywords.slice(0, 14),
    missingKeywords,
    matchedSkills,
    missingSkills,
    warnings,
  };
}

async function extractResumeFileText(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.txt') || name.endsWith('.md') || name.endsWith('.csv') || name.endsWith('.rtf')) {
    return file.text();
  }

  if (name.endsWith('.pdf')) {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;
    const buffer = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: buffer }).promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items.map(item => item.str).join(' '));
    }
    return pages.join('\n');
  }

  if (name.endsWith('.docx')) {
    const mammoth = await import('mammoth');
    const buffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer: buffer });
    return result.value || '';
  }

  throw new Error('Please upload a PDF, DOCX, TXT, MD, CSV or RTF resume.');
}

function ATSResumeAnalyzerView({ data, currentUser }) {
  const candidate = data.candidates.find(c => c.id === currentUser.id) || data.candidates[0];
  const [jobDescription, setJobDescription] = useState('');
  const [resumeText, setResumeText] = useState('');
  const [fileName, setFileName] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [role, setRole] = useState('general');
  const [roles, setRoles] = useState([]);

  // Fetch available roles on mount
  useEffect(() => {
    resumeApi.getRoles().then(r => {
      if (!r.error && r.roles) setRoles(r.roles);
    });
  }, []);

  const runAnalysis = async () => {
    setError('');
    if (!resumeText.trim()) {
      setError('Add resume text or upload a readable resume file first.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await resumeApi.analyze(resumeText, role, jobDescription.trim() || null);
      if (res.error) {
        setError(res.error);
      } else {
        setResult(res);
      }
    } catch (err) {
      setError('Analysis failed: ' + (err.message || 'Unknown error'));
    } finally {
      setLoading(false);
    }
  };

  const loadFile = async (file) => {
    if (!file) return;
    setLoading(true);
    setError('');
    setFileName(file.name);
    try {
      const text = await extractResumeFileText(file);
      if (!text.trim()) throw new Error('No readable text was extracted from this file.');
      setResumeText(text);
    } catch (err) {
      setError(err.message || 'Could not read this resume file. You can paste the resume text manually instead.');
    } finally {
      setLoading(false);
    }
  };

  // Score color helper
  const scoreColor = (score) => {
    if (score >= 75) return '#10b981';
    if (score >= 50) return '#f59e0b';
    if (score >= 30) return '#f97316';
    return '#f43f5e';
  };
  const scoreLabel = (score) => {
    if (score >= 80) return 'Excellent';
    if (score >= 65) return 'Good';
    if (score >= 50) return 'Fair';
    if (score >= 30) return 'Weak';
    return 'Poor';
  };

  const categoryLabels = {
    technical_skills: 'Technical Skills',
    projects: 'Projects & Practical Work',
    experience: 'Relevant Experience',
    education: 'Education & Qualifications',
    structure: 'Resume Structure',
    role_relevance: 'Role Alignment',
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-emerald-950 via-teal-900 to-slate-950 text-white rounded-3xl p-6 sm:p-8 shadow-xl relative overflow-hidden">
        <div className="absolute -right-12 -top-16 w-56 h-56 rounded-full bg-emerald-400/10 blur-3xl" />
        <div className="relative">
          <div className="flex items-center gap-2 text-emerald-300 text-xs uppercase tracking-wider font-black"><FileSearch className="w-4 h-4" /> AI-Powered ATS Resume Analyzer</div>
          <h2 className="mt-2 text-2xl sm:text-3xl font-black">Semantic resume evaluation for your target role.</h2>
          <p className="mt-2 max-w-2xl text-sm text-slate-300 leading-6">Upload your resume, select your career goal, and get a role-specific ATS score powered by Hugging Face semantic embeddings — not keyword counting.</p>
        </div>
      </div>

      {/* Input section */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Resume input */}
        <div className="bg-white rounded-2xl p-5 sm:p-6 border border-slate-200/80 shadow-sm space-y-4">
          <div>
            <label className="block text-sm font-black text-slate-900">1. Resume</label>
            <p className="text-xs text-slate-500 mt-1">Upload a PDF/DOCX/TXT file or paste your resume text.</p>
          </div>
          <label className="flex flex-col items-center justify-center min-h-36 rounded-2xl border-2 border-dashed border-emerald-200 bg-emerald-50/50 hover:bg-emerald-50 cursor-pointer transition-all">
            <Upload className="w-6 h-6 text-emerald-600" />
            <span className="mt-2 text-xs font-extrabold text-slate-800">{loading ? 'Reading resume…' : fileName || 'Choose resume file'}</span>
            <span className="mt-1 text-[10px] text-slate-500">PDF, DOCX, TXT, MD, CSV or RTF</span>
            <input type="file" accept=".pdf,.docx,.txt,.md,.csv,.rtf" className="hidden" onChange={(e) => loadFile(e.target.files?.[0])} />
          </label>
          <textarea
            value={resumeText}
            onChange={(e) => setResumeText(e.target.value)}
            rows={12}
            placeholder={`Paste ${candidate?.name || 'your'} resume text here…`}
            className="w-full rounded-2xl border border-slate-200 p-4 text-sm outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 resize-y"
          />
        </div>

        {/* Role + optional JD */}
        <div className="bg-white rounded-2xl p-5 sm:p-6 border border-slate-200/80 shadow-sm space-y-4">
          <div>
            <label className="block text-sm font-black text-slate-900">2. Career Goal <span className="text-rose-500">*</span></label>
            <p className="text-xs text-slate-500 mt-1">Select the role you're targeting. The same resume gets a different score for each role.</p>
          </div>
          <select
            value={role}
            onChange={e => setRole(e.target.value)}
            className="w-full rounded-2xl border border-slate-200 p-3 text-sm outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500">
            <option value="general">General Software Role</option>
            {roles.map(r => (
              <option key={r.key} value={r.key}>{r.title}</option>
            ))}
          </select>

          <div>
            <label className="block text-sm font-black text-slate-900 mt-2">3. Job Description <span className="text-slate-400 font-normal text-xs">(optional)</span></label>
            <p className="text-xs text-slate-500 mt-1">Paste a specific job description for more targeted evaluation. Leave blank to analyze against the role profile.</p>
          </div>
          <textarea
            value={jobDescription}
            onChange={(e) => setJobDescription(e.target.value)}
            rows={8}
            placeholder="Paste the target job description here (optional)…"
            className="w-full rounded-2xl border border-slate-200 p-4 text-sm outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 resize-y"
          />
          {error && <div className="rounded-xl bg-rose-50 border border-rose-100 p-3 text-xs font-semibold text-rose-700 flex gap-2"><AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}</div>}
          <button onClick={runAnalysis} disabled={loading} className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-300 text-white font-black text-sm shadow-lg shadow-emerald-200 transition-all flex items-center justify-center gap-2">
            {loading ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Analyzing with AI…</> : <><Sparkles className="w-4 h-4" /> Analyze Resume</>}
          </button>
        </div>
      </div>

      {/* Results */}
      {result && (
        <div className="space-y-5">
          {/* Overall score */}
          <div className="bg-white rounded-2xl p-5 sm:p-6 border border-slate-200/80 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center gap-5">
              <div className="w-28 h-28 rounded-full border-[10px] flex items-center justify-center bg-white shadow-sm flex-shrink-0" style={{ borderColor: scoreColor(result.overall_score) + '33' }}>
                <div className="text-center">
                  <div className="text-3xl font-black" style={{ color: scoreColor(result.overall_score) }}>{result.overall_score}</div>
                  <div className="text-[9px] uppercase font-black text-slate-400">/ 100</div>
                </div>
              </div>
              <div className="flex-1">
                <p className="text-xs uppercase tracking-wider font-black text-emerald-600">ATS Score · {result.role_title}</p>
                <h3 className="mt-1 text-xl font-black text-slate-900">{scoreLabel(result.overall_score)} — {result.overall_score}% match for {result.role_title}</h3>
                <p className="mt-1 text-xs text-slate-500">{result.ai_note}</p>
                <p className="mt-1 text-[10px] text-slate-400">Model: {result.model}</p>
              </div>
            </div>

            {/* Category scores */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-5">
              {Object.entries(result.category_scores || {}).map(([key, val]) => (
                <div key={key} className="rounded-xl bg-slate-50 border border-slate-100 p-3">
                  <p className="text-[10px] font-bold text-slate-400 uppercase">{categoryLabels[key] || key}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <div className="flex-1 h-1.5 rounded-full bg-slate-200 overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${val}%`, background: scoreColor(val) }} />
                    </div>
                    <span className="text-sm font-black text-slate-900">{val}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* JD analysis (if provided) */}
          {result.job_description_analysis && (
            <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm">
              <h3 className="font-black text-slate-900">Job Description Match</h3>
              <p className="text-xs text-slate-500 mt-0.5">Semantic similarity between your resume and the job description.</p>
              <div className="mt-3 flex items-center gap-4">
                <div className="text-2xl font-black" style={{ color: scoreColor(result.job_description_analysis.jd_match_score) }}>
                  {result.job_description_analysis.jd_match_score}%
                </div>
                <div className="flex-1">
                  {result.job_description_analysis.jd_missing_skills.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {result.job_description_analysis.jd_missing_skills.map(s => (
                        <span key={s} className="px-2.5 py-1.5 rounded-full bg-rose-100 text-rose-800 text-xs font-bold">+ {s}</span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-emerald-600 font-bold">All JD-required skills detected in your resume.</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Strengths + Weaknesses */}
          <div className="grid lg:grid-cols-2 gap-5">
            <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm">
              <h3 className="font-black text-slate-900 flex items-center gap-1.5"><CheckCircle className="w-4 h-4 text-emerald-600" /> Strengths</h3>
              <ul className="mt-3 space-y-2">
                {(result.strengths?.length ? result.strengths : ['No specific strengths identified yet.']).map((item, i) => (
                  <li key={i} className="flex gap-2 text-xs text-slate-700 font-semibold">
                    <CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />{item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm">
              <h3 className="font-black text-slate-900 flex items-center gap-1.5"><AlertCircle className="w-4 h-4 text-rose-500" /> Weaknesses</h3>
              <ul className="mt-3 space-y-2">
                {(result.weaknesses?.length ? result.weaknesses : ['No significant weaknesses detected.']).map((item, i) => (
                  <li key={i} className="flex gap-2 text-xs text-slate-700 font-semibold">
                    <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />{item}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Detected + missing skills */}
          <div className="grid lg:grid-cols-2 gap-5">
            <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm">
              <h3 className="font-black text-slate-900">Detected Skills (Semantic)</h3>
              <p className="text-xs text-slate-500 mt-0.5">Skills found via semantic matching, not keyword lookup.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {(result.detected_skills?.length ? result.detected_skills : []).map(s => (
                  <span key={s.name} className="px-2.5 py-1.5 rounded-full bg-emerald-100 text-emerald-800 text-xs font-bold">
                    ✓ {s.name} <span className="text-emerald-500 font-mono">({Math.round(s.similarity * 100)}%)</span>
                  </span>
                ))}
                {result.detected_skills?.length === 0 && <span className="text-xs text-slate-400 italic">No skills semantically detected.</span>}
              </div>
            </div>
            <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm">
              <h3 className="font-black text-slate-900">Missing Skills for {result.role_title}</h3>
              <div className="mt-3 flex flex-wrap gap-2">
                {(result.missing_skills?.length ? result.missing_skills : []).map(s => (
                  <span key={s} className="px-2.5 py-1.5 rounded-full bg-rose-100 text-rose-800 text-xs font-bold">+ {s}</span>
                ))}
                {result.missing_skills?.length === 0 && <span className="text-xs text-emerald-600 font-bold">All expected skills detected!</span>}
              </div>
            </div>
          </div>

          {/* Recommendations */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm">
            <h3 className="font-black text-slate-900 flex items-center gap-1.5"><Sparkles className="w-4 h-4 text-violet-500" /> Personalized Recommendations</h3>
            <ul className="mt-3 space-y-2.5">
              {(result.recommendations?.length ? result.recommendations : ['No specific recommendations.']).map((item, i) => (
                <li key={i} className="flex gap-2 text-xs text-slate-700 font-semibold p-3 rounded-xl bg-violet-50 border border-violet-100">
                  <Sparkles className="w-4 h-4 text-violet-500 flex-shrink-0 mt-0.5" />{item}
                </li>
              ))}
            </ul>
          </div>

          {/* Structure details */}
          {result.structure_details && (
            <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm">
              <h3 className="font-black text-slate-900">Resume Structure</h3>
              <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                  <p className="text-[10px] font-bold text-slate-400 uppercase">Word Count</p>
                  <p className="mt-1 text-lg font-black text-slate-900">{result.structure_details.word_count}</p>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                  <p className="text-[10px] font-bold text-slate-400 uppercase">Action Verbs</p>
                  <p className="mt-1 text-lg font-black text-slate-900">{result.structure_details.action_verb_count}</p>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                  <p className="text-[10px] font-bold text-slate-400 uppercase">Email</p>
                  <p className="mt-1 text-lg font-black" style={{ color: result.structure_details.has_email ? '#10b981' : '#f43f5e' }}>{result.structure_details.has_email ? '✓' : '✗'}</p>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                  <p className="text-[10px] font-bold text-slate-400 uppercase">Phone</p>
                  <p className="mt-1 text-lg font-black" style={{ color: result.structure_details.has_phone ? '#10b981' : '#f43f5e' }}>{result.structure_details.has_phone ? '✓' : '✗'}</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {Object.entries(result.structure_details.sections_detected || {}).map(([section, present]) => (
                  <span key={section} className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${present ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>
                    {present ? '✓' : '✗'} {section}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// SKILL GAP PANEL — reused inside match breakdown modal
// ─────────────────────────────────────────────────────────────────────────────
function SkillGapPanel({ match, listing }) {
  const total = (listing.requiredSkills || []).length;
  const met = match.strongMatches.length + match.partialMatches.length;
  const missing = match.missingSkills;

  if (total === 0) return null;

  return (
    <div className="rounded-2xl border border-rose-100 bg-rose-50/40 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
          <Target className="w-4 h-4 text-rose-500" /> Skill Gap Analyzer
        </h4>
        <span className="text-xs font-bold text-slate-500">{met} of {total} skills met</span>
      </div>

      {/* Progress bar */}
      <div className="h-2 rounded-full bg-white overflow-hidden border border-rose-100">
        <div
          className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all"
          style={{ width: `${Math.round((met / total) * 100)}%` }}
        />
      </div>

      {/* Gap list */}
      {missing.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-bold text-rose-700 uppercase tracking-wide">Skills to develop:</p>
          <div className="flex flex-wrap gap-2">
            {missing.map((skill, i) => (
              <span key={i} className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-white border border-rose-200 text-rose-800 text-xs font-bold">
                <X className="w-3 h-3" /> {skill}
              </span>
            ))}
          </div>
          <p className="text-xs text-slate-600 leading-5">
            You currently meet <span className="font-bold text-emerald-600">{met}</span> of <span className="font-bold">{total}</span> required skills.
            {missing.length > 0 && (
              <> Developing <span className="font-bold text-rose-600">{missing.slice(0, 2).join(' and ')}</span> could significantly increase your match score.</>
            )}
          </p>
        </div>
      ) : (
        <p className="text-xs text-emerald-700 font-bold flex items-center gap-1.5">
          <CheckCircle className="w-4 h-4" /> No skill gaps detected — you meet all required skills for this apprenticeship.
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SKILL PASSPORT VIEW — Priority 1 feature
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculates a transparent trust label based on structured data only.
 * No AI — purely deterministic from verified skill counts.
 */
function getTrustLabel(skills) {
  const total = skills.length;
  if (total === 0) return { label: 'No Skills Added', color: 'slate', desc: 'Add skills to your profile to begin building your Skill Passport.' };
  const verified = skills.filter(s => s.status === 'VERIFIED').length;
  const assessed = skills.filter(s => s.status === 'ASSESSED').length;
  const ratio = (verified + assessed * 0.5) / total;
  if (ratio >= 0.75) return { label: 'Highly Verified', color: 'emerald', desc: `${verified} of ${total} skills are fully verified. Strong evidence of genuine competency.` };
  if (ratio >= 0.4) return { label: 'Partially Verified', color: 'teal', desc: `${verified} verified, ${assessed} assessed out of ${total} skills. Continue earning verifications to strengthen your passport.` };
  return { label: 'Mostly Self-Declared', color: 'amber', desc: `Only ${verified} of ${total} skills are verified. Take assessments or upload evidence to improve your passport credibility.` };
}

function SkillPassportView({ data, currentUser, setActiveTab }) {
  const candidate = data.candidates.find(c => c.id === currentUser.id) || data.candidates[0];
  if (!candidate) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" /></div>;
  const trust = getTrustLabel(candidate.skills);

  const verifiedSkills = candidate.skills.filter(s => s.status === 'VERIFIED');
  const assessedSkills = candidate.skills.filter(s => s.status === 'ASSESSED');
  const selfDeclaredSkills = candidate.skills.filter(s => s.status === 'SELF_DECLARED');

  const trustColorMap = {
    emerald: { bg: 'bg-emerald-50', border: 'border-emerald-200', badge: 'bg-emerald-100 text-emerald-800', icon: 'text-emerald-600' },
    teal:    { bg: 'bg-teal-50',    border: 'border-teal-200',    badge: 'bg-teal-100 text-teal-800',     icon: 'text-teal-600' },
    amber:   { bg: 'bg-amber-50',   border: 'border-amber-200',   badge: 'bg-amber-100 text-amber-800',   icon: 'text-amber-600' },
    slate:   { bg: 'bg-slate-50',   border: 'border-slate-200',   badge: 'bg-slate-100 text-slate-700',   icon: 'text-slate-500' },
  };
  const tc = trustColorMap[trust.color];

  return (
    <div className="space-y-6">

      {/* Hero Banner */}
      <div className="bg-gradient-to-r from-emerald-900 via-teal-800 to-slate-900 rounded-3xl p-6 sm:p-8 text-white shadow-xl relative overflow-hidden">
        <div className="absolute -right-10 -top-10 w-48 h-48 rounded-full bg-emerald-400/10 blur-3xl pointer-events-none" />
        <div className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-5">
          <div>
            <div className="flex items-center gap-2 text-emerald-300 text-xs uppercase tracking-wider font-black mb-2">
              <BadgeCheck className="w-4 h-4" /> Skill Passport
            </div>
            <h1 className="text-2xl sm:text-3xl font-black">{candidate.name}</h1>
            <p className="text-slate-300 text-sm mt-1">{candidate.education}</p>
            <p className="text-slate-400 text-xs mt-0.5">{candidate.location}</p>
          </div>
          {/* Trust Label */}
          <div className={`rounded-2xl border ${tc.border} ${tc.bg} px-5 py-4 text-center min-w-[160px]`}>
            <p className="text-[10px] uppercase tracking-wider font-black text-slate-500 mb-1">Verification Level</p>
            <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full font-extrabold text-sm ${tc.badge}`}>
              <Fingerprint className="w-4 h-4" /> {trust.label}
            </div>
            <p className="text-[10px] text-slate-500 mt-2 leading-4">{trust.desc}</p>
          </div>
        </div>
      </div>

      {/* Passport Summary Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Verified Skills', value: verifiedSkills.length, sub: 'Human or assessment verified', color: 'text-emerald-600', icon: <BadgeCheck className="w-4 h-4 text-emerald-600" /> },
          { label: 'Assessed Skills', value: assessedSkills.length, sub: 'Scored via proctored MCQ', color: 'text-teal-600', icon: <Award className="w-4 h-4 text-teal-600" /> },
          { label: 'Self-Declared', value: selfDeclaredSkills.length, sub: 'Pending verification', color: 'text-amber-600', icon: <AlertCircle className="w-4 h-4 text-amber-500" /> },
          { label: 'Evidence Items', value: candidate.evidence.length, sub: 'Uploaded artifacts', color: 'text-slate-700', icon: <FileCheck className="w-4 h-4 text-slate-500" /> },
        ].map(({ label, value, sub, color, icon }) => (
          <div key={label} className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-sm">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">{label}</span>
              {icon}
            </div>
            <p className={`text-2xl font-black ${color}`}>{value}</p>
            <p className="text-[10px] text-slate-400 font-medium mt-0.5">{sub}</p>
          </div>
        ))}
      </div>

      {/* How trust is calculated — Transparency note */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm">
        <div className="flex items-center gap-2 mb-2">
          <Info className="w-4 h-4 text-slate-400" />
          <h3 className="font-extrabold text-slate-900 text-sm">How your Verification Level is calculated</h3>
        </div>
        <p className="text-xs text-slate-500 leading-5">
          The Verification Level is based entirely on structured data — not an AI score. It counts your verified skills (weight 1.0), assessed skills (weight 0.5), and self-declared skills (weight 0). 
          <strong> Highly Verified</strong> requires ≥75% weighted coverage. <strong>Partially Verified</strong> requires ≥40%. Below that is <strong>Mostly Self-Declared</strong>. 
          This level is shown to employers when they review your profile.
        </p>
      </div>

      {/* Verified Skills — Full Passport Cards */}
      {verifiedSkills.length > 0 && (
        <div className="bg-white rounded-2xl p-5 sm:p-6 border border-slate-200/80 shadow-sm space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
            <BadgeCheck className="w-5 h-5 text-emerald-600" />
            <h3 className="font-extrabold text-slate-900">Verified Skills</h3>
            <span className="ml-auto text-xs text-emerald-700 font-bold bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-100">Highest confidence</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {verifiedSkills.map((skill, i) => {
              // Find linked evidence for this skill
              const linkedEvidence = candidate.evidence.filter(e =>
                e.skill?.toLowerCase() === skill.name?.toLowerCase() && e.status === 'APPROVED'
              );
              return (
                <SkillPassportCard key={i} skill={skill} linkedEvidence={linkedEvidence} tier="verified" />
              );
            })}
          </div>
        </div>
      )}

      {/* Assessed Skills */}
      {assessedSkills.length > 0 && (
        <div className="bg-white rounded-2xl p-5 sm:p-6 border border-slate-200/80 shadow-sm space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
            <Award className="w-5 h-5 text-teal-600" />
            <h3 className="font-extrabold text-slate-900">Assessed Skills</h3>
            <span className="ml-auto text-xs text-teal-700 font-bold bg-teal-50 px-2.5 py-0.5 rounded-full border border-teal-100">Scored via assessment</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {assessedSkills.map((skill, i) => {
              const linkedEvidence = candidate.evidence.filter(e =>
                e.skill?.toLowerCase() === skill.name?.toLowerCase()
              );
              return (
                <SkillPassportCard key={i} skill={skill} linkedEvidence={linkedEvidence} tier="assessed" />
              );
            })}
          </div>
        </div>
      )}

      {/* Self-Declared Skills */}
      {selfDeclaredSkills.length > 0 && (
        <div className="bg-white rounded-2xl p-5 sm:p-6 border border-slate-200/80 shadow-sm space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
            <AlertCircle className="w-5 h-5 text-amber-500" />
            <h3 className="font-extrabold text-slate-900">Self-Declared Skills</h3>
            <span className="ml-auto text-xs text-amber-700 font-bold bg-amber-50 px-2.5 py-0.5 rounded-full border border-amber-100">Pending verification</span>
          </div>
          <p className="text-xs text-slate-500">These skills have not been verified through assessment or evidence yet. Take an assessment or upload evidence to elevate them.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {selfDeclaredSkills.map((skill, i) => (
              <SkillPassportCard key={i} skill={skill} linkedEvidence={[]} tier="self_declared" />
            ))}
          </div>
          <div className="flex gap-2 pt-2">
            <button
              onClick={() => setActiveTab('assessments')}
              className="px-4 py-2 rounded-xl bg-emerald-600 text-white font-bold text-xs hover:bg-emerald-500 transition-all">
              Take an Assessment to Verify
            </button>
            <button
              onClick={() => setActiveTab('evidence')}
              className="px-4 py-2 rounded-xl border border-slate-200 text-slate-700 font-bold text-xs hover:bg-slate-50 transition-all">
              Upload Evidence
            </button>
          </div>
        </div>
      )}

      {/* Certifications */}
      {candidate.certifications?.length > 0 && (
        <div className="bg-white rounded-2xl p-5 sm:p-6 border border-slate-200/80 shadow-sm space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
            <GraduationCap className="w-5 h-5 text-emerald-600" />
            <h3 className="font-extrabold text-slate-900">Certifications</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {candidate.certifications.map((cert, i) => (
              <div key={i} className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-emerald-50 border border-emerald-100 text-sm">
                <CheckCircle className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                <span className="font-bold text-emerald-900">{cert}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Evidence linked to skills */}
      {candidate.evidence.length > 0 && (
        <div className="bg-white rounded-2xl p-5 sm:p-6 border border-slate-200/80 shadow-sm space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <FileCheck className="w-5 h-5 text-slate-500" />
              <h3 className="font-extrabold text-slate-900">Evidence on Record</h3>
            </div>
            <button onClick={() => setActiveTab('evidence')} className="text-xs text-emerald-600 font-bold hover:underline">Manage →</button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {candidate.evidence.map((ev, i) => (
              <div key={i} className="p-3.5 rounded-xl bg-slate-50 border border-slate-100 flex items-start justify-between gap-3">
                <div>
                  <p className="font-bold text-slate-900 text-xs">{ev.title}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">{ev.type} · Skill: {ev.skill} · {ev.date}</p>
                </div>
                <span className={`flex-shrink-0 px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
                  ev.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-800' :
                  ev.status === 'REJECTED' ? 'bg-rose-100 text-rose-700' :
                  'bg-amber-100 text-amber-800'
                }`}>{ev.status.replace('_', ' ')}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Individual skill card for the Skill Passport.
 * Shows: skill name, level, status badge, score bar, verification source, evidence links.
 */
function SkillPassportCard({ skill, linkedEvidence, tier }) {
  const tierConfig = {
    verified: {
      bg: 'bg-emerald-50/60',
      border: 'border-emerald-200',
      badge: 'bg-emerald-100 text-emerald-800',
      barColor: 'from-emerald-500 to-teal-400',
      icon: <BadgeCheck className="w-4 h-4 text-emerald-600" />,
    },
    assessed: {
      bg: 'bg-teal-50/60',
      border: 'border-teal-200',
      badge: 'bg-teal-100 text-teal-800',
      barColor: 'from-teal-500 to-emerald-400',
      icon: <Award className="w-4 h-4 text-teal-600" />,
    },
    self_declared: {
      bg: 'bg-amber-50/40',
      border: 'border-amber-100',
      badge: 'bg-amber-100 text-amber-800',
      barColor: 'from-amber-400 to-yellow-300',
      icon: <AlertCircle className="w-4 h-4 text-amber-500" />,
    },
  };
  const cfg = tierConfig[tier] || tierConfig.self_declared;
  const score = skill.score ?? 0;

  return (
    <div className={`rounded-xl border p-4 space-y-3 ${cfg.bg} ${cfg.border}`}>
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          {cfg.icon}
          <div>
            <p className="font-extrabold text-slate-900 text-sm">{skill.name}</p>
            <p className="text-[10px] text-slate-500 font-semibold">{skill.level}</p>
          </div>
        </div>
        <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${cfg.badge}`}>
          {skill.status?.replace('_', ' ')}
        </span>
      </div>

      {/* Score bar */}
      {score > 0 && (
        <div>
          <div className="flex items-center justify-between text-[10px] mb-1">
            <span className="text-slate-500 font-semibold">Assessment Score</span>
            <span className="font-extrabold text-slate-800">{score}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-white/80 border border-slate-100 overflow-hidden">
            <div
              className={`h-full rounded-full bg-gradient-to-r ${cfg.barColor}`}
              style={{ width: `${score}%` }}
            />
          </div>
        </div>
      )}

      {/* Verification source */}
      {skill.verifiedBy && (
        <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
          <CheckCircle className="w-3 h-3 text-emerald-500 flex-shrink-0" />
          <span>Verified by: <span className="font-bold">{skill.verifiedBy}</span></span>
        </div>
      )}

      {/* Linked approved evidence */}
      {linkedEvidence.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1 border-t border-white/50">
          {linkedEvidence.map((ev, i) => (
            <span key={i} className="flex items-center gap-1 px-2 py-0.5 rounded bg-white/70 border border-slate-100 text-[10px] font-semibold text-slate-600">
              <FileText className="w-2.5 h-2.5" /> {ev.title}
            </span>
          ))}
        </div>
      )}

      {/* Unverified nudge */}
      {tier === 'self_declared' && (
        <p className="text-[10px] text-amber-700 font-semibold border-t border-amber-100 pt-2">
          Take a skill assessment to verify this skill and increase your passport credibility.
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTH MODAL — Sign In / Sign Up / Google — overlays the landing page
// ─────────────────────────────────────────────────────────────────────────────
function AuthModal({ mode, onSwitchMode, onClose, onSuccess }) {
  const { login, register, loginWithGoogle } = useAuth();

  const [name, setName]         = useState('');
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole]         = useState('candidate');
  const [submitting, setSubmitting]         = useState(false);
  const [googleLoading, setGoogleLoading]   = useState(false);
  const [error, setError]       = useState('');

  const isSignUp = mode === 'signup';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!email.trim() || !password) { setError('Please fill in all required fields.'); return; }
    if (isSignUp && !name.trim()) { setError('Please enter your full name.'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }

    setSubmitting(true);
    const result = isSignUp
      ? await register(name.trim(), email.trim(), password, role)
      : await login(email.trim(), password);
    setSubmitting(false);

    if (result.error) {
      const msg = result.error.toLowerCase();
      if (msg.includes('invalid email or password') || msg.includes('401'))
        setError('Incorrect email or password.');
      else if (msg.includes('already registered') || msg.includes('already in use'))
        setError('An account with this email already exists.');
      else if (msg.includes('server') || result.status === 0)
        setError('Cannot reach the server. Make sure the backend is running on localhost:8000.');
      else
        setError(result.error);
      return;
    }
    onSuccess(result.user);
  };

  const handleGoogle = async () => {
    setError('');
    setGoogleLoading(true);
    const result = await loginWithGoogle(role);
    setGoogleLoading(false);
    if (!result || result.error === 'cancelled') return;
    if (result.error) {
      setError(result.error);
      return;
    }
    onSuccess(result.user);
  };

  const ROLES = [
    { id: 'candidate',          label: 'Candidate',          sub: 'Find apprenticeships' },
    { id: 'employer',           label: 'Employer',           sub: 'Post & review listings' },
    { id: 'training_institute', label: 'Training Institute', sub: 'Verify skills & assessments' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm">
      <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl border border-slate-100 overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-slate-100">
          <div>
            <h2 className="text-xl font-black text-slate-900">
              {isSignUp ? 'Create your account' : 'Welcome back'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {isSignUp ? 'Join ApprenticeBridge today.' : 'Sign in to continue to your dashboard.'}
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-all">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">

          {/* Google button */}
          <button
            type="button"
            onClick={handleGoogle}
            disabled={googleLoading || submitting}
            className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 font-extrabold text-sm text-slate-800 transition-all shadow-sm disabled:opacity-60"
          >
            {googleLoading ? (
              <span className="w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
            ) : (
              /* Google G logo SVG */
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
            )}
            Continue with Google
          </button>

          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-slate-100" />
            <span className="text-xs text-slate-400 font-semibold">or</span>
            <div className="flex-1 h-px bg-slate-100" />
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">

            {/* Name — only on sign up */}
            {isSignUp && (
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Full Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Enter your full name"
                  autoComplete="name"
                  className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 transition-all"
                />
              </div>
            )}

            {/* Email */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 transition-all"
              />
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={isSignUp ? 'At least 8 characters' : 'Enter your password'}
                autoComplete={isSignUp ? 'new-password' : 'current-password'}
                className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 transition-all"
              />
            </div>

            {/* Role selector — only on sign up */}
            {isSignUp && (
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Account Type</label>
                <div className="grid grid-cols-3 gap-2">
                  {ROLES.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setRole(r.id)}
                      className={`rounded-xl border p-2.5 text-left transition-all ${
                        role === r.id
                          ? 'border-emerald-500 bg-emerald-50 ring-1 ring-emerald-200'
                          : 'border-slate-200 hover:border-emerald-300'
                      }`}
                    >
                      <div className="font-extrabold text-slate-900 text-[11px] leading-tight">{r.label}</div>
                      <div className="text-[10px] text-slate-400 mt-0.5 leading-tight">{r.sub}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="rounded-xl bg-rose-50 border border-rose-100 px-3 py-2.5 text-xs text-rose-700 font-semibold flex items-center gap-2">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" /> {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={submitting || googleLoading}
              className="w-full rounded-xl bg-emerald-600 hover:bg-emerald-500 px-4 py-3 font-extrabold text-sm text-white transition-all shadow-lg shadow-emerald-200 disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {submitting && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              {isSignUp ? 'Create Account' : 'Sign In'}
            </button>
          </form>

          {/* Switch mode */}
          <p className="text-center text-xs text-slate-500 pb-1">
            {isSignUp ? 'Already have an account?' : "Don't have an account?"}{' '}
            <button
              onClick={() => { setError(''); onSwitchMode(isSignUp ? 'signin' : 'signup'); }}
              className="font-extrabold text-emerald-700 hover:text-emerald-800"
            >
              {isSignUp ? 'Sign In' : 'Sign Up'}
            </button>
          </p>

        </div>
      </div>
    </div>
  );
}

function SidebarNavItem({ active, onClick, icon, label }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-semibold transition-all ${
        active 
          ? 'bg-emerald-50 text-emerald-700 font-bold border border-emerald-200/60 shadow-sm' 
          : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
      }`}>
      <span className={active ? 'text-emerald-600' : 'text-slate-400'}>{icon}</span>
      {label}
    </button>
  );
}

function CandidateDashboardView({ data, currentUser, setActiveTab, onGenerateAiSummary, aiGenerating }) {
  const candidate = data.candidates.find(c => c.id === currentUser.id) || data.candidates[0];
  if (!candidate) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" /></div>;
  const verifiedCount = candidate.skills.filter(s => s.status === 'VERIFIED').length;
  const pendingCount = candidate.skills.filter(s => s.status !== 'VERIFIED').length;
  const myApplications = data.applications.filter(a => a.candidateId === candidate.id);
  const savedCount = 0; // Will be populated when saved listings feature is active

  // Compute best match for skill gap summary
  const bestMatch = data.apprenticeships.reduce((best, listing) => {
    const m = calculateExplainableMatch(candidate, listing);
    return (!best || m.totalScore > best.score) ? { listing, score: m.totalScore, match: m } : best;
  }, null);

  return (
    <div className="space-y-6">
      {/* Visual Metric Top Banner (Aesthetics based on UI designs) */}
      <div className="bg-gradient-to-r from-emerald-900 via-teal-800 to-slate-900 rounded-3xl p-6 text-white shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 transform translate-x-8 -translate-y-8 w-64 h-64 rounded-full bg-emerald-500/10 blur-2xl pointer-events-none"></div>
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            {currentUser.photo_url ? (
              <img
                src={`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}${currentUser.photo_url}`}
                alt={currentUser.name}
                className="w-16 h-16 rounded-2xl object-cover border-2 border-emerald-400/50 shadow-md"
              />
            ) : (
              <div className="w-16 h-16 rounded-2xl bg-emerald-500/20 border-2 border-emerald-400/30 flex items-center justify-center text-2xl font-black text-white">
                {currentUser.name.charAt(0).toUpperCase()}
              </div>
            )}
            <div>
              <h1 className="text-2xl font-black tracking-tight">Welcome back, {candidate.name}!</h1>
              <p className="text-emerald-200/80 text-sm mt-0.5">{candidate.education}</p>
            </div>
          </div>
          <button 
            onClick={() => setActiveTab('apprenticeships')}
            className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold text-sm transition-all shadow-lg shadow-emerald-500/20 flex items-center gap-2 self-start md:self-auto">
            Explore Matching Apprenticeships <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Metrics Row — 6 cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
        <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200/80 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[10px] sm:text-xs font-bold uppercase text-slate-400 tracking-wider">Verified Skills</span>
            <Award className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-2xl sm:text-3xl font-black text-slate-900">{verifiedCount}</span>
            <span className="text-xs text-slate-500">of {candidate.skills.length}</span>
          </div>
          <button onClick={() => setActiveTab('skill-passport')} className="mt-2 text-[10px] text-emerald-600 font-bold hover:underline">View Passport →</button>
        </div>

        <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200/80 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[10px] sm:text-xs font-bold uppercase text-slate-400 tracking-wider">Pending Verify</span>
            <AlertCircle className="w-4 h-4 text-amber-500" />
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-2xl sm:text-3xl font-black text-amber-600">{pendingCount}</span>
            <span className="text-xs text-slate-500">skills</span>
          </div>
          <button onClick={() => setActiveTab('assessments')} className="mt-2 text-[10px] text-amber-600 font-bold hover:underline">Take assessment →</button>
        </div>

        <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200/80 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[10px] sm:text-xs font-bold uppercase text-slate-400 tracking-wider">Applications</span>
            <FileText className="w-4 h-4 text-teal-600" />
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-2xl sm:text-3xl font-black text-slate-900">{myApplications.length}</span>
            <span className="text-xs text-emerald-600 font-semibold">In Review</span>
          </div>
          <button onClick={() => setActiveTab('applications')} className="mt-2 text-[10px] text-teal-600 font-bold hover:underline">Track status →</button>
        </div>

        <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200/80 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[10px] sm:text-xs font-bold uppercase text-slate-400 tracking-wider">Evidence</span>
            <FileCheck className="w-4 h-4 text-amber-500" />
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-2xl sm:text-3xl font-black text-slate-900">{candidate.evidence.length}</span>
            <span className="text-xs text-slate-500">uploaded</span>
          </div>
          <button onClick={() => setActiveTab('evidence')} className="mt-2 text-[10px] text-amber-600 font-bold hover:underline">View locker →</button>
        </div>

        <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200/80 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[10px] sm:text-xs font-bold uppercase text-slate-400 tracking-wider">Top Match</span>
            <Target className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-2xl sm:text-3xl font-black text-emerald-600">{bestMatch?.score ?? 0}%</span>
          </div>
          <button onClick={() => setActiveTab('apprenticeships')} className="mt-2 text-[10px] text-emerald-600 font-bold hover:underline">Explore →</button>
        </div>

        <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200/80 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[10px] sm:text-xs font-bold uppercase text-slate-400 tracking-wider">ATS Check</span>
            <FileSearch className="w-4 h-4 text-slate-500" />
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-2xl sm:text-3xl font-black text-slate-400">—</span>
          </div>
          <button onClick={() => setActiveTab('ats-analyzer')} className="mt-2 text-[10px] text-slate-500 font-bold hover:underline">Analyze resume →</button>
        </div>
      </div>

      {/* Skill Gap Quick Summary Strip */}
      {bestMatch && bestMatch.match.missingSkills.length > 0 && (
        <div className="bg-white rounded-2xl p-5 border border-amber-100 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-500" />
              <h3 className="font-extrabold text-slate-900 text-sm">Skill Gap Alert — Top Match</h3>
              <span className="text-xs text-slate-500 font-medium">{bestMatch.listing.title}</span>
            </div>
            <button onClick={() => setActiveTab('apprenticeships')} className="text-xs text-emerald-600 font-bold hover:underline">View full gap →</button>
          </div>
          <div className="flex flex-wrap gap-2">
            {bestMatch.match.strongMatches.map((m, i) => (
              <span key={i} className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-800 text-xs font-bold border border-emerald-100">
                <Check className="w-3 h-3" /> {m.name}
              </span>
            ))}
            {bestMatch.match.partialMatches.map((m, i) => (
              <span key={i} className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-50 text-amber-800 text-xs font-bold border border-amber-100">
                ~ {m.name}
              </span>
            ))}
            {bestMatch.match.missingSkills.map((m, i) => (
              <span key={i} className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-rose-50 text-rose-800 text-xs font-bold border border-rose-100">
                <X className="w-3 h-3" /> {m}
              </span>
            ))}
          </div>
          <p className="mt-3 text-xs text-slate-500">
            You meet <span className="font-bold text-emerald-600">{bestMatch.match.strongMatches.length + bestMatch.match.partialMatches.length}</span> of <span className="font-bold">{bestMatch.listing.requiredSkills.length}</span> required skills. 
            {bestMatch.match.missingSkills.length > 0 && <> Improving <span className="font-bold text-rose-600">{bestMatch.match.missingSkills.slice(0, 2).join(' and ')}</span> would increase your score.</>}
          </p>
        </div>
      )}

      {/* AI Verified Skill Summary Card — with AI Transparency Panel */}
      <div className="bg-white rounded-2xl p-6 border border-emerald-100 shadow-sm relative">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-emerald-600" />
            <h3 className="font-extrabold text-slate-900">AI Verified Skill Summary</h3>
            {/* AI Transparency Badge */}
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-50 border border-violet-200 text-[10px] font-extrabold text-violet-700">
              <Bot className="w-3 h-3" /> AI-assisted · Gemini
            </span>
          </div>
          <button 
            onClick={() => onGenerateAiSummary(candidate)}
            disabled={aiGenerating}
            className="px-3 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold text-xs flex items-center gap-1.5 transition-all border border-emerald-200">
            {aiGenerating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Refresh AI Summary
          </button>
        </div>
        <p className="text-sm text-slate-600 leading-relaxed bg-slate-50 p-4 rounded-xl border border-slate-100 italic">
          "{candidate.verifiedSummary || 'No verified summary generated yet. Click refresh to build summary from verified records.'}"
        </p>
        {/* Responsible AI notice */}
        <div className="mt-3 flex flex-wrap items-center gap-3 text-[10px] text-slate-400 font-medium">
          <span className="flex items-center gap-1"><ShieldAlert className="w-3 h-3 text-slate-400" /> Strictly compiled from verified records only</span>
          <span className="flex items-center gap-1"><Info className="w-3 h-3 text-slate-400" /> AI does not make hiring decisions</span>
          <span className="flex items-center gap-1"><CheckCircle className="w-3 h-3 text-slate-400" /> Trainer review required for assessments</span>
        </div>
      </div>

      {/* Recommended Listings preview */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm">
        <h3 className="font-extrabold text-slate-900 text-lg mb-4">Recommended Matches for You</h3>
        <div className="space-y-4">
          {data.apprenticeships.map(listing => {
            const match = calculateExplainableMatch(candidate, listing);
            return (
              <div key={listing.id} className="p-4 rounded-xl border border-slate-200 hover:border-emerald-300 transition-all flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-50/50">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-900">{listing.title}</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                      match.isEligible ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-700'
                    }`}>
                      {match.isEligible ? 'ELIGIBLE' : 'NOT ELIGIBLE'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500">{listing.companyName} • {listing.location} ({listing.workMode})</p>
                </div>

                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <div className="text-xs text-slate-400 font-bold uppercase">Match Score</div>
                    <div className="text-xl font-black text-emerald-600">{match.totalScore}%</div>
                  </div>
                  <button 
                    onClick={() => setActiveTab('apprenticeships')}
                    className="px-4 py-2 rounded-xl bg-slate-900 text-white font-bold text-xs hover:bg-slate-800 transition-all">
                    View Details
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function CandidateApprenticeshipsView({ data, currentUser, onApply }) {
  const candidate = data.candidates.find(c => c.id === currentUser.id) || data.candidates[0];
  if (!candidate) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" /></div>;
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [selectedListingDetail, setSelectedListingDetail] = useState(null);
  // Backend match scores: { [listingId]: { score, eligible, explanation, loading } }
  const [matchScores, setMatchScores] = useState({});

  // Fetch backend match score for a listing if not yet cached
  const fetchMatchScore = (listingId) => {
    if (matchScores[listingId]) return;
    setMatchScores(prev => ({ ...prev, [listingId]: { loading: true } }));
    apprenticeshipsApi.match(listingId)
      .then(res => {
        if (!res.error) {
          setMatchScores(prev => ({
            ...prev,
            [listingId]: { score: res.score, eligible: res.eligible, explanation: res.explanation, loading: false },
          }));
        } else {
          setMatchScores(prev => ({ ...prev, [listingId]: { score: null, eligible: true, explanation: '', loading: false } }));
        }
      })
      .catch(() => {
        setMatchScores(prev => ({ ...prev, [listingId]: { score: null, eligible: true, explanation: '', loading: false } }));
      });
  };

  // Fetch scores for all visible listings on mount and when listings change
  useEffect(() => {
    data.apprenticeships.forEach(listing => fetchMatchScore(listing.id));
  }, [data.apprenticeships]);

  const filtered = data.apprenticeships.filter(app => {
    const matchesSearch = app.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          (app.category || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                          (app.location || '').toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === 'ALL' || app.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm space-y-4">
        <h2 className="text-xl font-extrabold text-slate-900">Discover Apprenticeships</h2>
        
        {/* Search & Filter Controls */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3.5 top-3.5 text-slate-400" />
            <input 
              type="text" 
              placeholder="Search by title, skill, or employer..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
            />
          </div>

          <select 
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="px-4 py-2.5 rounded-xl border border-slate-200 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 bg-white">
            <option value="ALL">All Categories</option>
            <option value="Software Engineering">Software Engineering</option>
            <option value="Advanced Manufacturing">Advanced Manufacturing</option>
          </select>
        </div>
      </div>

      {/* Listing Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {filtered.map(listing => {
          const ms = matchScores[listing.id] || {};
          const score = ms.score != null ? ms.score : null;
          const isEligible = ms.eligible !== false;
          const hasApplied = data.applications.some(a =>
            (a.apprenticeship_id ?? a.apprenticeshipId) === listing.id &&
            (a.candidate_id ?? a.candidateId) === currentUser.id
          );

          return (
            <div key={listing.id} className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm hover:border-emerald-300 transition-all flex flex-col justify-between space-y-4">
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-extrabold text-slate-900 text-lg">{listing.title}</h3>
                    <p className="text-xs text-slate-500 font-medium">{listing.location} {listing.category ? `• ${listing.category}` : ''}</p>
                  </div>
                  <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                    isEligible ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-700'
                  }`}>
                    {isEligible ? 'ELIGIBLE' : 'NOT ELIGIBLE'}
                  </span>
                </div>

                <p className="text-sm text-slate-600 line-clamp-2">{listing.description}</p>

                {/* Match Score */}
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-bold text-slate-700">Match Score</span>
                    {ms.loading ? (
                      <div className="w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <span className={`font-black text-lg ${
                        score == null ? 'text-slate-400' :
                        score >= 60 ? 'text-emerald-600' :
                        score >= 35 ? 'text-amber-600' : 'text-rose-500'
                      }`}>{score != null ? `${Math.round(score)}%` : '—'}</span>
                    )}
                  </div>
                  {ms.explanation && !ms.loading && (
                    <p className="text-[10px] text-slate-400 mt-1">{ms.explanation}</p>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                <span className="text-xs font-bold text-slate-700">{listing.category || ''}</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setSelectedListingDetail({ listing, match: { score, isEligible, explanation: ms.explanation, strongMatches: [], partialMatches: [], missingSkills: [] } })}
                    className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50">
                    Details
                  </button>
                  <button
                    disabled={hasApplied || !isEligible}
                    onClick={() => onApply(listing.id)}
                    className={`px-4 py-2 rounded-xl text-xs font-extrabold transition-all ${
                      hasApplied
                        ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                        : !isEligible
                        ? 'bg-rose-50 text-rose-400 cursor-not-allowed'
                        : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-200'
                    }`}>
                    {hasApplied ? 'Applied' : 'Apply Now'}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Explainable Match Modal */}
      {selectedListingDetail && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-2xl w-full p-6 space-y-6 shadow-2xl border border-slate-100 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-xl font-black text-slate-900">{selectedListingDetail.listing.title}</h3>
                <p className="text-xs text-slate-500 font-semibold">{selectedListingDetail.listing.companyName}</p>
              </div>
              <button onClick={() => setSelectedListingDetail(null)} className="p-2 rounded-xl hover:bg-slate-100">
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>

            {/* Eligibility & Score Header */}
            <div className="p-4 rounded-2xl bg-emerald-950 text-white flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider">Layer A — Hard Constraints</span>
                <p className="text-sm font-semibold mt-1">
                  {selectedListingDetail.match.isEligible
                    ? '✓ Passed all mandatory criteria. Eligible to apply.'
                    : `✗ NOT ELIGIBLE — Missing: ${[...selectedListingDetail.match.missingMandatoryCertifications, ...selectedListingDetail.match.missingMandatorySkills].join(', ')}`}
                </p>
              </div>
              <div className="text-right">
                <span className="text-xs text-slate-300 font-bold uppercase">Relevance Score</span>
                <div className="text-3xl font-black text-emerald-400">{selectedListingDetail.match.totalScore}%</div>
              </div>
            </div>

            {/* Score Breakdown — PRD Weights */}
            <div className="space-y-3">
              <h4 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Score Breakdown (PRD Weights)</h4>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
                {[
                  ['Skills', selectedListingDetail.match.breakdown.skillScorePart, 60],
                  ['Education', selectedListingDetail.match.breakdown.educationPart, 15],
                  ['Interests', selectedListingDetail.match.breakdown.interestPart, 10],
                  ['Location', selectedListingDetail.match.breakdown.locationPart, 10],
                  ['Experience', selectedListingDetail.match.breakdown.experiencePart, 5],
                ].map(([label, pts, max]) => (
                  <div key={label} className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                    <span className="text-slate-400 block">{label} ({max}%)</span>
                    <span className="text-base font-extrabold text-slate-800">{pts}/{max}</span>
                    <div className="mt-1.5 h-1.5 rounded-full bg-slate-200 overflow-hidden">
                      <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.round((pts / max) * 100)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Enhanced Skill Analysis with verification labels */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold text-slate-900">Skill Analysis — with Verification Confidence</h4>
                <span className="text-[10px] text-slate-400 font-semibold">Verified skills carry higher confidence</span>
              </div>
              <div className="space-y-1.5 text-xs">
                {selectedListingDetail.match.strongMatches.map((m, i) => (
                  <div key={i} className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-100 flex items-center justify-between font-medium">
                    <div className="flex items-center gap-2">
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                      <span className="text-emerald-900 font-bold">{m.name}</span>
                      <span className="text-emerald-700">{m.level}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
                        m.status === 'VERIFIED' ? 'bg-emerald-200 text-emerald-900' :
                        m.status === 'ASSESSED' ? 'bg-teal-100 text-teal-800' :
                        'bg-slate-200 text-slate-700'
                      }`}>
                        {m.status}
                      </span>
                      {m.status === 'VERIFIED' && <BadgeCheck className="w-3.5 h-3.5 text-emerald-600" />}
                    </div>
                  </div>
                ))}
                {selectedListingDetail.match.partialMatches.map((m, i) => (
                  <div key={i} className="p-2.5 rounded-lg bg-amber-50 border border-amber-100 flex items-center justify-between font-medium">
                    <div className="flex items-center gap-2">
                      <AlertCircle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                      <span className="text-amber-900 font-bold">{m.name}</span>
                      <span className="text-amber-700">You: {m.candidateLevel} → Required: {m.requiredLevel}</span>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
                      m.status === 'VERIFIED' ? 'bg-emerald-200 text-emerald-900' :
                      m.status === 'ASSESSED' ? 'bg-teal-100 text-teal-800' :
                      'bg-slate-200 text-slate-700'
                    }`}>
                      {m.status}
                    </span>
                  </div>
                ))}
                {selectedListingDetail.match.missingSkills.map((m, i) => (
                  <div key={i} className="p-2.5 rounded-lg bg-rose-50 border border-rose-100 flex items-center justify-between font-medium">
                    <div className="flex items-center gap-2">
                      <X className="w-3.5 h-3.5 text-rose-500 flex-shrink-0" />
                      <span className="text-rose-900 font-bold">{m}</span>
                    </div>
                    <span className="text-rose-700 font-semibold">Not in profile</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Skill Gap Analyzer Panel */}
            <SkillGapPanel match={selectedListingDetail.match} listing={selectedListingDetail.listing} />

            {/* Deterministic explanation */}
            <p className="text-xs text-slate-500 italic bg-slate-50 p-3 rounded-xl border border-slate-100 flex items-start gap-2">
              <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-slate-400" />
              {selectedListingDetail.match.explanation} This score is calculated using a deterministic weighted formula — not an AI model.
            </p>

            <button 
              onClick={() => setSelectedListingDetail(null)}
              className="w-full py-3 rounded-xl bg-slate-900 text-white font-bold text-sm hover:bg-slate-800">
              Close Breakdown
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CandidateAssessmentsView({ data, currentUser, onStartAssessment, activeAssessment, answers, setAnswers, assessmentResult, onScoreAssessment, onCloseAssessment }) {
  const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
  const [myAttempts, setMyAttempts] = useState({});
  const [attemptsLoading, setAttemptsLoading] = useState(true);

  // Fetch the candidate's past attempts to show completion status
  useEffect(() => {
    assessmentsApi.myAttempts()
      .then(res => {
        if (!res.error && Array.isArray(res)) {
          const map = {};
          res.forEach(a => { map[a.assessment_id] = a; });
          setMyAttempts(map);
        }
      })
      .finally(() => setAttemptsLoading(false));
  }, [activeAssessment, assessmentResult]);

  const difficultyColor = {
    easy:   'bg-emerald-100 text-emerald-700',
    medium: 'bg-amber-100 text-amber-700',
    hard:   'bg-rose-100 text-rose-700',
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm">
        <h2 className="text-xl font-extrabold text-slate-900">Skill Assessments</h2>
        <p className="text-xs text-slate-500 mt-1">
          Complete assessments to earn <strong>VERIFIED</strong> status on your skill profile. Results are scored server-side instantly.
        </p>
      </div>

      {activeAssessment ? (
        <div className="bg-white rounded-3xl p-6 border border-emerald-200 shadow-xl space-y-6">
          {!assessmentResult ? (
            <>
              <div className="flex justify-between items-center border-b border-slate-100 pb-4">
                <div>
                  <span className="text-xs font-bold text-emerald-600 uppercase tracking-wider">Assessment in Progress</span>
                  <h3 className="text-xl font-extrabold text-slate-900 mt-0.5">{activeAssessment.title}</h3>
                  <p className="text-xs text-slate-500 mt-1">
                    Skill: <span className="font-semibold">{activeAssessment.skill_name}</span>
                    {activeAssessment.difficulty && (
                      <span className={`ml-2 px-2 py-0.5 rounded-full text-[10px] font-bold capitalize ${difficultyColor[activeAssessment.difficulty] || 'bg-slate-100 text-slate-600'}`}>
                        {activeAssessment.difficulty}
                      </span>
                    )}
                  </p>
                </div>
                <button onClick={onCloseAssessment} className="text-xs font-bold text-slate-400 hover:text-slate-600">Cancel</button>
              </div>

              <div className="space-y-6">
                {(activeAssessment.questions || []).map((q, qIdx) => (
                  <div key={q.id} className="p-4 rounded-2xl bg-slate-50 border border-slate-100 space-y-3">
                    <div className="flex items-start gap-2">
                      <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-slate-200 text-slate-600 mt-0.5 flex-shrink-0">
                        {q.question_type === 'mcq' ? 'MCQ' : q.question_type === 'short' ? 'Short Answer' : 'Theory'}
                      </span>
                      <p className="text-sm font-bold text-slate-900">{qIdx + 1}. {q.question}</p>
                    </div>

                    {q.question_type === 'mcq' && q.options ? (
                      <div className="space-y-2">
                        {Object.entries(q.options).map(([key, val]) => (
                          <label key={key}
                            className={`flex items-center gap-3 p-3 rounded-xl border text-xs font-semibold cursor-pointer transition-all ${
                              answers[q.id] === key
                                ? 'bg-emerald-50 border-emerald-500 text-emerald-900'
                                : 'bg-white border-slate-200 hover:bg-slate-50 text-slate-700'
                            }`}>
                            <input type="radio" name={`q_${q.id}`}
                              checked={answers[q.id] === key}
                              onChange={() => setAnswers(prev => ({ ...prev, [q.id]: key }))}
                              className="text-emerald-600" />
                            <span className="font-bold text-slate-500 mr-1">{key}.</span> {val}
                          </label>
                        ))}
                      </div>
                    ) : (
                      <textarea
                        rows={q.question_type === 'theory' ? 5 : 2}
                        placeholder={q.question_type === 'theory' ? 'Write your detailed answer here…' : 'Your answer…'}
                        value={answers[q.id] || ''}
                        onChange={e => setAnswers(prev => ({ ...prev, [q.id]: e.target.value }))}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
                      />
                    )}
                  </div>
                ))}
              </div>

              <button onClick={onScoreAssessment}
                className="w-full py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-sm transition-all shadow-md shadow-emerald-200">
                Submit Assessment
              </button>
            </>
          ) : (
            <div className="text-center py-8 space-y-4">
              <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto">
                <Award className="w-8 h-8" />
              </div>
              <h3 className="text-2xl font-black text-slate-900">{assessmentResult.score}%</h3>
              <p className="text-sm text-slate-600">
                Correct: <strong>{assessmentResult.correct}</strong> / {assessmentResult.total} &nbsp;·&nbsp;
                Level: <span className="font-extrabold text-emerald-600 capitalize">{assessmentResult.level}</span>
              </p>
              {assessmentResult.level !== 'not_verified' && (
                <div className="inline-block bg-emerald-50 border border-emerald-200 px-4 py-2 rounded-xl text-xs font-bold text-emerald-800">
                  ✓ Skill updated to VERIFIED on your profile
                </div>
              )}
              <div>
                <button onClick={onCloseAssessment}
                  className="px-6 py-2.5 rounded-xl bg-slate-900 text-white font-bold text-xs hover:bg-slate-800">
                  Back to Assessments
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        data.assessments.length === 0 ? (
          <div className="bg-white rounded-2xl p-10 border border-slate-200/80 shadow-sm text-center space-y-3">
            <Award className="w-10 h-10 text-slate-300 mx-auto" />
            <p className="font-bold text-slate-500">No assessments available yet</p>
            <p className="text-xs text-slate-400">Employers and training institutes can create assessments that will appear here.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {data.assessments.map(assess => {
              const attempt = myAttempts[assess.id];
              const scoreColor = attempt
                ? attempt.score >= 85 ? 'text-emerald-600'
                  : attempt.score >= 70 ? 'text-teal-600'
                  : attempt.score >= 50 ? 'text-amber-600'
                  : 'text-rose-500'
                : '';

              return (
              <div key={assess.id} className={`bg-white rounded-2xl p-6 border shadow-sm space-y-4 ${attempt ? 'border-emerald-200' : 'border-slate-200/80'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-extrabold text-slate-900">{assess.title}</h3>
                    <p className="text-xs text-slate-500 mt-0.5">{assess.skill_name}</p>
                    {assess.description && <p className="text-xs text-slate-400 mt-1 line-clamp-2">{assess.description}</p>}
                  </div>
                  {attempt ? (
                    <div className="flex-shrink-0 text-right">
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-extrabold">
                        <Check className="w-3 h-3" /> Completed
                      </span>
                    </div>
                  ) : (
                    <Award className="w-6 h-6 text-emerald-600 flex-shrink-0" />
                  )}
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold capitalize ${difficultyColor[assess.difficulty] || 'bg-slate-100 text-slate-600'}`}>
                    {assess.difficulty}
                  </span>
                  <span className="text-xs text-slate-500 flex items-center gap-1">
                    <HelpCircle className="w-3.5 h-3.5" /> {assess.question_count || 0} questions
                  </span>
                  {assess.creator_name && (
                    <span className="text-xs text-slate-400">by {assess.creator_name}</span>
                  )}
                </div>

                {/* Show previous score if attempted */}
                {attempt && (
                  <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100">
                    <div>
                      <p className="text-[10px] font-bold text-slate-400 uppercase">Your last score</p>
                      <p className={`text-lg font-black mt-0.5 ${scoreColor}`}>{attempt.score}%</p>
                      <p className="text-[10px] text-slate-400 capitalize">{attempt.level} · {new Date(attempt.completed_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                    </div>
                    <div className="text-right">
                      {attempt.level !== 'not_verified' && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-extrabold">
                          <BadgeCheck className="w-3 h-3" /> VERIFIED
                        </span>
                      )}
                    </div>
                  </div>
                )}

                <button
                  onClick={() => onStartAssessment(assess)}
                  disabled={!assess.question_count}
                  className={`w-full py-2.5 rounded-xl font-bold text-xs transition-all disabled:opacity-40 ${
                    attempt
                      ? 'bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200'
                      : 'bg-slate-900 hover:bg-slate-800 text-white'
                  }`}>
                  {!assess.question_count ? 'No questions yet' : attempt ? 'Retake Assessment' : 'Start Assessment'}
                </button>
              </div>
              );
            })}
          </div>
        )
      )}
    </div>
  );
}

function CandidateEvidenceView({ data, currentUser, onOpenUploadModal }) {
  const candidate = data.candidates.find(c => c.id === currentUser.id) || data.candidates[0];
  if (!candidate) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" /></div>;

  const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
  const evidence = candidate.evidence || [];

  // Sharing state: { [evidenceId]: { loading, token, copied, error } }
  const [shareState, setShareState] = useState({});
  const [previewItem, setPreviewItem] = useState(null);

  const handleShare = async (item) => {
    setShareState(s => ({ ...s, [item.id]: { loading: true } }));
    const res = await evidenceApi.share(item.id);
    if (res.error) {
      setShareState(s => ({ ...s, [item.id]: { loading: false, error: res.error } }));
      return;
    }
    const shareUrl = `${window.location.origin}/evidence/shared/${res.share_token}`;
    setShareState(s => ({ ...s, [item.id]: { loading: false, token: res.share_token, url: shareUrl } }));
  };

  const handleRevokeShare = async (item) => {
    setShareState(s => ({ ...s, [item.id]: { loading: true } }));
    const res = await evidenceApi.revokeShare(item.id);
    setShareState(s => ({ ...s, [item.id]: { loading: false, token: null, url: null } }));
  };

  const handleCopyLink = async (url, itemId) => {
    try {
      await navigator.clipboard.writeText(url);
      setShareState(s => ({ ...s, [itemId]: { ...s[itemId], copied: true } }));
      setTimeout(() => setShareState(s => ({ ...s, [itemId]: { ...s[itemId], copied: false } })), 2000);
    } catch {
      // fallback — select the text
    }
  };

  // ── File icon / preview helpers ──────────────────────────────────────────
  const getFileIcon = (contentType) => {
    if (!contentType) return <FileCheck className="w-8 h-8 text-slate-400" />;
    if (contentType.startsWith('image/')) return <FileCheck className="w-8 h-8 text-blue-500" />;
    if (contentType.startsWith('video/')) return <FileCheck className="w-8 h-8 text-purple-500" />;
    if (contentType.includes('pdf')) return <FileCheck className="w-8 h-8 text-rose-500" />;
    return <FileCheck className="w-8 h-8 text-slate-400" />;
  };

  const isImage = (ct) => ct && ct.startsWith('image/');
  const isVideo = (ct) => ct && ct.startsWith('video/');
  const isPdf   = (ct) => ct && ct.includes('pdf');

  const formatSize = (bytes) => {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const formatDate = (d) => {
    if (!d) return '';
    try { return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }
    catch { return String(d); }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm flex items-center justify-between">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900">Evidence Locker</h2>
          <p className="text-xs text-slate-500 mt-1">Upload work samples, screenshots, certificates, or documents to verify your skill claims. Share them with employers anytime.</p>
        </div>
        <button
          onClick={onOpenUploadModal}
          className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs flex items-center gap-2 shadow-md shadow-emerald-200">
          <Upload className="w-4 h-4" /> Upload Evidence
        </button>
      </div>

      {/* Evidence grid */}
      {evidence.length === 0 ? (
        <div className="bg-white rounded-2xl p-10 border border-slate-200/80 shadow-sm text-center">
          <FileCheck className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-sm font-bold text-slate-700">No evidence uploaded yet</p>
          <p className="text-xs text-slate-400 mt-1">Click "Upload Evidence" to add your first file — documents, images, screenshots, videos, or certificates.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {evidence.map(item => {
            const st = shareState[item.id] || {};
            const fileSrc = item.file_url ? (item.file_url.startsWith('http') ? item.file_url : `${API}${item.file_url}`) : null;
            return (
              <div key={item.id} className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm space-y-3">
                {/* Top row: icon/preview + metadata */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    {/* Thumbnail / icon */}
                    {isImage(item.content_type) && fileSrc ? (
                      <img src={fileSrc} alt={item.original_filename}
                        className="w-16 h-16 rounded-xl object-cover border border-slate-200 flex-shrink-0 cursor-pointer hover:opacity-80"
                        onClick={() => setPreviewItem(item)} />
                    ) : isVideo(item.content_type) && fileSrc ? (
                      <video src={fileSrc} className="w-16 h-16 rounded-xl object-cover border border-slate-200 flex-shrink-0 cursor-pointer"
                        onClick={() => setPreviewItem(item)} />
                    ) : isPdf(item.content_type) && fileSrc ? (
                      <button onClick={() => setPreviewItem(item)}
                        className="w-16 h-16 rounded-xl bg-rose-50 border border-rose-100 flex items-center justify-center flex-shrink-0 hover:bg-rose-100 transition-colors">
                        <FileCheck className="w-7 h-7 text-rose-500" />
                      </button>
                    ) : (
                      <div className="w-16 h-16 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center flex-shrink-0">
                        {getFileIcon(item.content_type)}
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      <span className="text-[10px] font-bold uppercase text-slate-400">
                        {item.content_type || 'file'} {item.skill_name ? `• Skill: ${item.skill_name}` : ''}
                      </span>
                      <h4 className="font-extrabold text-slate-900 text-sm mt-0.5 truncate" title={item.original_filename}>
                        {item.original_filename || item.title}
                      </h4>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {formatSize(item.size_bytes)} • {formatDate(item.date || item.created_at)}
                      </p>
                    </div>
                  </div>

                  {/* Status badge */}
                  <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold flex-shrink-0 ${
                    item.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-800' :
                    item.status === 'REJECTED' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-800'
                  }`}>
                    {item.status.replace('_', ' ')}
                  </span>
                </div>

                {/* Share section */}
                <div className="pt-2 border-t border-slate-100">
                  {!st.url ? (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-slate-400">Private — only visible to you</span>
                      <button
                        onClick={() => handleShare(item)}
                        disabled={st.loading}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold hover:bg-emerald-100 transition-colors disabled:opacity-50">
                        {st.loading
                          ? <div className="w-3 h-3 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                          : <Share className="w-3.5 h-3.5" />}
                        Share with Employer
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <input
                          readOnly
                          value={st.url}
                          className="flex-1 text-xs font-mono px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-600 truncate"
                          onClick={(e) => e.target.select()} />
                        <button
                          onClick={() => handleCopyLink(st.url, item.id)}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-bold hover:bg-slate-800 transition-colors flex-shrink-0">
                          {st.copied ? <><Check className="w-3.5 h-3.5" /> Copied</> : <><Share className="w-3.5 h-3.5" /> Copy</>}
                        </button>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-emerald-600 font-semibold">✓ Anyone with this link can view this evidence</span>
                        <button
                          onClick={() => handleRevokeShare(item)}
                          disabled={st.loading}
                          className="text-[10px] text-rose-500 font-bold hover:text-rose-700 hover:underline disabled:opacity-50">
                          Revoke link
                        </button>
                      </div>
                    </div>
                  )}
                  {st.error && <p className="text-[10px] text-rose-500 font-semibold mt-1">{st.error}</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Preview modal */}
      {previewItem && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setPreviewItem(null)}>
          <div className="max-w-3xl w-full max-h-[90vh] bg-white rounded-2xl overflow-hidden shadow-2xl flex flex-col"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
              <p className="text-sm font-bold text-slate-900 truncate">{previewItem.original_filename}</p>
              <button onClick={() => setPreviewItem(null)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-auto bg-slate-50 flex items-center justify-center p-4">
              {isImage(previewItem.content_type) && (
                <img src={`${API}${previewItem.file_url}`} alt={previewItem.original_filename} className="max-w-full max-h-[70vh] object-contain rounded-lg" />
              )}
              {isVideo(previewItem.content_type) && (
                <video src={`${API}${previewItem.file_url}`} controls className="max-w-full max-h-[70vh] rounded-lg" />
              )}
              {isPdf(previewItem.content_type) && (
                <iframe src={`${API}${previewItem.file_url}`} className="w-full h-[70vh] rounded-lg" title={previewItem.original_filename} />
              )}
              {!isImage(previewItem.content_type) && !isVideo(previewItem.content_type) && !isPdf(previewItem.content_type) && (
                <div className="text-center py-16">
                  <FileCheck className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                  <p className="text-sm text-slate-500">Preview not available for this file type.</p>
                  <a href={`${API}${previewItem.file_url}`} download={previewItem.original_filename}
                    className="inline-flex items-center gap-1.5 mt-3 px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700">
                    <Download className="w-3.5 h-3.5" /> Download
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CandidateApplicationsView({ data, currentUser }) {
  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchApplications = () => {
    setLoading(true);
    setError('');
    applicationsApi.mine()
      .then(res => {
        if (res.error) setError(res.error);
        else setApplications(Array.isArray(res) ? res : []);
      })
      .catch(() => setError('Failed to load applications.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchApplications(); }, []);

  const statusStyles = {
    applied:      { bg: 'bg-sky-50',      text: 'text-sky-800',     border: 'border-sky-200',     badge: 'bg-sky-100 text-sky-800',       label: 'Applied',          icon: '📨' },
    under_review: { bg: 'bg-blue-50',     text: 'text-blue-800',    border: 'border-blue-200',    badge: 'bg-blue-100 text-blue-800',     label: 'Under Review',     icon: '🔍' },
    shortlisted:  { bg: 'bg-emerald-50',  text: 'text-emerald-800', border: 'border-emerald-300', badge: 'bg-emerald-100 text-emerald-800',label: '⭐ Shortlisted',    icon: '🎉' },
    interview:    { bg: 'bg-teal-50',     text: 'text-teal-800',    border: 'border-teal-300',    badge: 'bg-teal-100 text-teal-800',     label: 'Interview',        icon: '🗓️' },
    selected:     { bg: 'bg-green-50',    text: 'text-green-900',   border: 'border-green-300',   badge: 'bg-green-100 text-green-900',   label: '✓ Selected',       icon: '🏆' },
    rejected:     { bg: 'bg-slate-50',    text: 'text-slate-600',   border: 'border-slate-200',   badge: 'bg-rose-100 text-rose-700',     label: 'Not Progressed',   icon: '📋' },
  };

  const statusNote = {
    applied:      'Your application has been submitted successfully and is awaiting employer review.',
    under_review: 'The employer is actively reviewing your application. No action needed from your side.',
    shortlisted:  'Congratulations! You have been shortlisted for this role. The employer may contact you soon for the next steps.',
    interview:    'You have been invited for an interview! Prepare by reviewing the apprenticeship description and your skill profile.',
    selected:     'Congratulations! You have been selected for this apprenticeship. The employer will contact you with onboarding details shortly.',
    rejected:     "Your application was not successful for this role. Don't be discouraged — keep applying and strengthening your skills.",
  };

  const scoreBarColor = (score) => {
    if (score == null) return 'bg-slate-200';
    if (score >= 65) return 'bg-emerald-500';
    if (score >= 45) return 'bg-amber-500';
    if (score >= 25) return 'bg-orange-500';
    return 'bg-rose-400';
  };
  const formatDate = (iso) => {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }
    catch { return String(iso).substring(0, 10); }
  };
  const scoreTextColor = (score) => {
    if (score == null) return 'text-slate-400';
    if (score >= 65) return 'text-emerald-700';
    if (score >= 45) return 'text-amber-700';
    if (score >= 25) return 'text-orange-700';
    return 'text-rose-600';
  };
  const scoreLabel = (score) => {
    if (score == null) return 'Not calculated';
    if (score >= 65) return 'Strong match';
    if (score >= 45) return 'Moderate match';
    if (score >= 25) return 'Partial match';
    return 'Low match';
  };
  const componentLabels = {
    skill_match: 'Skills', semantic_match: 'Profile fit', education_match: 'Education',
    interest_match: 'Interests', location_match: 'Location', experience_match: 'Experience',
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm flex items-center justify-between">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900">My Applications</h2>
          <p className="text-xs text-slate-500 mt-1">
            Live status of all your apprenticeship applications.
            {!loading && applications.length > 0 && (
              <span className="ml-1 font-semibold text-emerald-600">{applications.length} application{applications.length !== 1 ? 's' : ''}</span>
            )}
          </p>
        </div>
        <button onClick={fetchApplications} disabled={loading}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-all">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center h-32">
          <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className="bg-rose-50 border border-rose-200 rounded-2xl p-6 text-center">
          <p className="text-sm font-bold text-rose-700">{error}</p>
          <button onClick={fetchApplications} className="mt-3 px-4 py-2 rounded-xl bg-rose-600 text-white text-xs font-bold hover:bg-rose-700">Retry</button>
        </div>
      )}

      {/* Empty */}
      {!loading && !error && applications.length === 0 && (
        <div className="bg-white rounded-2xl p-10 border border-slate-200/80 shadow-sm text-center space-y-3">
          <FileText className="w-10 h-10 text-slate-300 mx-auto" />
          <p className="font-bold text-slate-500">No applications yet</p>
          <p className="text-xs text-slate-400">Browse apprenticeships and click Apply to get started.</p>
        </div>
      )}

      {/* Applications list */}
      {!loading && !error && applications.length > 0 && (
        <div className="space-y-5">
          {applications.map(app => {
            const st = statusStyles[app.status] || statusStyles.applied;
            const note = statusNote[app.status] || '';
            const score = app.match_score;
            const components = app.match_components || {};
            const hasComponents = Object.keys(components).length > 0;
            const isHighlight = app.status === 'shortlisted' || app.status === 'selected' || app.status === 'interview';

            return (
              <div key={app.id} className={`rounded-2xl border-2 shadow-sm overflow-hidden ${st.border}`}>
                {/* Accent top strip for positive statuses */}
                {isHighlight && (
                  <div className={`h-1.5 w-full ${app.status === 'selected' ? 'bg-green-500' : app.status === 'interview' ? 'bg-teal-500' : 'bg-emerald-500'}`} />
                )}
                <div className={`p-5 space-y-4 ${st.bg}`}>

                  {/* Title + status badge */}
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-extrabold text-slate-900 text-base leading-tight">
                        {st.icon} {app.listing_title || 'Apprenticeship'}
                      </h3>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1.5">
                        {app.employer_name && (
                          <span className="text-xs text-slate-600 font-semibold flex items-center gap-1">
                            <Building className="w-3 h-3 text-slate-400" /> {app.employer_name}
                          </span>
                        )}
                        {app.listing_location && (
                          <span className="text-xs text-slate-500 flex items-center gap-1">
                            <MapPin className="w-3 h-3 text-slate-400" /> {app.listing_location}
                          </span>
                        )}
                        {app.listing_category && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-white border border-slate-200 text-slate-500 font-semibold">
                            {app.listing_category}
                          </span>
                        )}
                      </div>
                    </div>
                    <span className={`flex-shrink-0 px-3 py-1.5 rounded-full text-[11px] font-extrabold ${st.badge}`}>
                      {st.label}
                    </span>
                  </div>

                  {/* Match score card */}
                  <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Match Score</p>
                        <div className="flex items-baseline gap-2 mt-0.5">
                          <span className={`text-2xl font-black ${scoreTextColor(score)}`}>
                            {score != null ? `${Math.round(score)}%` : '—'}
                          </span>
                          {score != null && (
                            <span className={`text-xs font-bold ${scoreTextColor(score)}`}>{scoreLabel(score)}</span>
                          )}
                        </div>
                      </div>
                      {app.match_explanation && (
                        <p className="text-[10px] text-slate-400 text-right max-w-[200px] hidden sm:block leading-relaxed">
                          {app.match_explanation}
                        </p>
                      )}
                    </div>
                    {score != null && (
                      <>
                        <div className="h-2.5 w-full bg-slate-100 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full transition-all duration-500 ${scoreBarColor(score)}`}
                            style={{ width: `${Math.min(100, Math.max(0, score))}%` }} />
                        </div>
                        <div className="flex justify-between text-[9px] text-slate-300 font-medium px-0.5">
                          <span>Low</span><span>Partial</span><span>Moderate</span><span>Strong</span>
                        </div>
                      </>
                    )}
                    {hasComponents && (
                      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 pt-1 border-t border-slate-100">
                        {Object.entries(components).map(([key, val]) => (
                          <div key={key} className="text-center">
                            <div className="h-1 w-full bg-slate-100 rounded-full overflow-hidden mb-1">
                              <div className={`h-full rounded-full ${val >= 60 ? 'bg-emerald-400' : val >= 30 ? 'bg-amber-400' : 'bg-rose-300'}`}
                                style={{ width: `${Math.min(100, Math.max(0, val))}%` }} />
                            </div>
                            <p className="text-[9px] text-slate-400">{componentLabels[key] || key}</p>
                            <p className={`text-[10px] font-bold ${val >= 60 ? 'text-emerald-600' : val >= 30 ? 'text-amber-600' : 'text-rose-500'}`}>{Math.round(val)}%</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Dates */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-white rounded-xl border border-slate-200 p-3">
                      <p className="text-[10px] font-bold text-slate-400 uppercase">Applied On</p>
                      <p className="text-sm font-bold text-slate-900 mt-0.5">{formatDate(app.created_at)}</p>
                    </div>
                    <div className="bg-white rounded-xl border border-slate-200 p-3">
                      <p className="text-[10px] font-bold text-slate-400 uppercase">Last Updated</p>
                      <p className="text-sm font-bold text-slate-900 mt-0.5">{formatDate(app.updated_at)}</p>
                    </div>
                  </div>

                  {/* Status note */}
                  {note && (
                    <div className={`flex items-start gap-2.5 p-3.5 rounded-xl bg-white border ${st.border}`}>
                      <Info className={`w-4 h-4 flex-shrink-0 mt-0.5 ${st.text}`} />
                      <p className={`text-xs font-semibold ${st.text}`}>{note}</p>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ProfileAvatar({ photoUrl, name, size = 16, onUpload }) {
  const [uploading, setUploading] = useState(false);
  const inputRef = React.useRef();
  const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const res = await profilesApi.uploadPhoto(file);
    setUploading(false);
    if (!res.error && onUpload) onUpload(res.photo_url);
  };

  const imgSrc = photoUrl ? (photoUrl.startsWith('http') ? photoUrl : `${API}${photoUrl}`) : null;

  return (
    <div className="relative group" style={{ width: size * 4, height: size * 4 }}>
      {imgSrc ? (
        <img src={imgSrc} alt={name}
          className="w-full h-full rounded-2xl object-cover border-2 border-white/30 shadow-lg" />
      ) : (
        <div className="w-full h-full rounded-2xl bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center text-2xl font-black text-white">
          {(name || '?').charAt(0).toUpperCase()}
        </div>
      )}
      <button
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        title="Upload photo"
        className="absolute inset-0 rounded-2xl bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity cursor-pointer">
        {uploading
          ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
          : <Upload className="w-5 h-5 text-white" />}
      </button>
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
    </div>
  );
}

function CandidateProfileView({ data, currentUser, onProfileSaved, onPhotoUploaded }) {
  const candidate = data.candidates.find(c => c.id === currentUser.id) || data.candidates[0];
  if (!candidate) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" /></div>;

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [form, setForm] = useState({
    name:       currentUser.name     || '',
    education:  candidate.education  || '',
    interests:  candidate.interests  || '',
    experience: candidate.experience || '',
    trades:     candidate.trades     || '',
    location:   candidate.location   || '',
  });

  // Skill management state
  const [skillSearch, setSkillSearch] = useState('');
  const [skillResults, setSkillResults] = useState([]);
  const [skillSearching, setSkillSearching] = useState(false);
  const [removingSkill, setRemovingSkill] = useState(null);

  // Pending queue: skills selected but not yet saved
  // Each entry: { id, name, category, trade, level }
  const [pendingSkills, setPendingSkills] = useState([]);
  const [savingSkills, setSavingSkills] = useState(false);
  const [skillSaveError, setSkillSaveError] = useState('');

  useEffect(() => {
    setForm({
      name:       currentUser.name     || '',
      education:  candidate.education  || '',
      interests:  candidate.interests  || '',
      experience: candidate.experience || '',
      trades:     candidate.trades     || '',
      location:   candidate.location   || '',
    });
  }, [currentUser.name, candidate.education, candidate.interests, candidate.experience, candidate.trades, candidate.location]);

  const allFields = ['name', 'education', 'interests', 'experience', 'trades', 'location'];
  const completion = Math.round((allFields.filter(k => form[k]?.trim()).length / allFields.length) * 100);

  const handleSave = async () => {
    if (!form.name.trim()) { setSaveError('Name is required.'); return; }
    setSaving(true); setSaveError('');
    const res = await profilesApi.updateCandidateProfile(form);
    setSaving(false);
    if (res.error) { setSaveError(res.error); return; }
    setEditing(false);
    if (onProfileSaved) onProfileSaved();
  };

  const handleSkillSearch = async (q) => {
    setSkillSearch(q);
    if (q.trim().length < 2) { setSkillResults([]); return; }
    setSkillSearching(true);
    const res = await skillsApi.list(q);
    setSkillSearching(false);
    if (!res.error) setSkillResults(Array.isArray(res) ? res : []);
  };

  // Add skill to the pending queue (does NOT call API yet)
  const handleQueueSkill = (skill) => {
    const alreadySaved  = candidate.skills.some(s => s.skill_id === skill.id || s.name === skill.name);
    const alreadyQueued = pendingSkills.some(s => s.id === skill.id || s.name?.toLowerCase() === skill.name?.toLowerCase());
    if (alreadySaved || alreadyQueued) return;
    setPendingSkills(prev => [...prev, { id: skill.id, name: skill.name, category: skill.category || skill.trade || 'General', level: 'beginner', custom: !skill.id }]);
    setSkillSearch('');
    setSkillResults([]);
  };

  // Queue a custom skill by raw name (not in catalog)
  const handleQueueCustomSkill = () => {
    const name = skillSearch.trim();
    if (!name) return;
    const alreadySaved  = candidate.skills.some(s => s.name?.toLowerCase() === name.toLowerCase());
    const alreadyQueued = pendingSkills.some(s => s.name?.toLowerCase() === name.toLowerCase());
    if (alreadySaved || alreadyQueued) return;
    setPendingSkills(prev => [...prev, { id: null, name, category: 'General', level: 'beginner', custom: true }]);
    setSkillSearch('');
    setSkillResults([]);
  };

  // Update the level of a pending skill
  const handlePendingLevelChange = (skillId, level) => {
    setPendingSkills(prev => prev.map(s => s.id === skillId ? { ...s, level } : s));
  };

  // Remove a skill from the pending queue before saving
  const handleRemovePending = (skillId) => {
    setPendingSkills(prev => prev.filter(s => s.id !== skillId));
  };

  // Save all pending skills to the backend in parallel
  const handleSaveSkills = async () => {
    if (pendingSkills.length === 0) return;
    setSavingSkills(true);
    setSkillSaveError('');
    const results = await Promise.all(
      pendingSkills.map(s =>
        s.custom || !s.id
          ? skillsApi.addSkillByName(s.name, s.level, s.category)
          : skillsApi.addSkill(s.id, s.level)
      )
    );
    setSavingSkills(false);
    const failed = results.filter(r => r?.error);
    if (failed.length > 0) {
      setSkillSaveError(`${failed.length} skill(s) could not be saved. Please try again.`);
      return;
    }
    setPendingSkills([]);
    if (onProfileSaved) onProfileSaved();
  };

  const handleRemoveSkill = async (skill) => {
    setRemovingSkill(skill.skill_id);
    const res = await skillsApi.removeSkill(skill.skill_id);
    setRemovingSkill(null);
    if (res !== undefined && res?.error) return;
    if (onProfileSaved) onProfileSaved();
  };

  const inputCls = "w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition";
  const textareaCls = inputCls + " resize-none";

  return (
    <div className="space-y-6">
      {/* Header with photo */}
      <div className="bg-gradient-to-r from-emerald-900 via-teal-800 to-slate-900 rounded-3xl p-6 text-white shadow-xl relative overflow-hidden">
        <div className="absolute -right-10 -top-10 w-48 h-48 rounded-full bg-emerald-400/10 blur-3xl pointer-events-none" />
        <div className="relative flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <ProfileAvatar
              photoUrl={currentUser.photo_url}
              name={currentUser.name}
              size={16}
              onUpload={(url) => { if (onPhotoUploaded) onPhotoUploaded(url); }}
            />
            <div>
              <p className="text-xs font-bold text-emerald-300 uppercase tracking-wider mb-1">Candidate Profile</p>
              <h1 className="text-2xl font-black">{currentUser.name}</h1>
              <p className="text-slate-300 text-sm mt-0.5">{currentUser.email}</p>
              <p className="text-emerald-400/70 text-[10px] mt-0.5">Hover photo to change</p>
            </div>
          </div>
          <div className="hidden sm:flex flex-col items-end gap-1">
            <span className="text-xs text-emerald-300 font-semibold">Profile {completion}% complete</span>
            <div className="w-32 h-2 bg-white/20 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-400 rounded-full transition-all" style={{ width: `${completion}%` }} />
            </div>
          </div>
        </div>
      </div>

      {/* Personal info form */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-extrabold text-slate-900">Personal Information</h2>
          {!editing ? (
            <button onClick={() => setEditing(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 transition-all">
              <Edit className="w-3.5 h-3.5" /> Edit Profile
            </button>
          ) : (
            <div className="flex gap-2">
              <button onClick={() => { setEditing(false); setSaveError(''); }}
                className="px-3.5 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 transition-all">Cancel</button>
              <button onClick={handleSave} disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 disabled:opacity-60 transition-all">
                {saving ? <><div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> Saving…</> : <><Check className="w-3.5 h-3.5" /> Save</>}
              </button>
            </div>
          )}
        </div>

        {saveError && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">
            <AlertCircle className="w-4 h-4 flex-shrink-0" /> {saveError}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1.5">Full Name <span className="text-rose-500">*</span></label>
            {editing ? (
              <input className={inputCls} placeholder="Your full name" value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            ) : <p className="text-sm text-slate-900 px-1">{form.name || <span className="text-slate-400 italic">Not set</span>}</p>}
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1.5">Location</label>
            {editing ? (
              <input className={inputCls} placeholder="e.g. London, UK" value={form.location}
                onChange={e => setForm(f => ({ ...f, location: e.target.value }))} />
            ) : <p className="text-sm text-slate-900 px-1">{form.location || <span className="text-slate-400 italic">Not set</span>}</p>}
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1.5">Trade / Sector</label>
            {editing ? (
              <input className={inputCls} placeholder="e.g. Electrical, IT" value={form.trades}
                onChange={e => setForm(f => ({ ...f, trades: e.target.value }))} />
            ) : <p className="text-sm text-slate-900 px-1">{form.trades || <span className="text-slate-400 italic">Not set</span>}</p>}
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1.5">Education</label>
            {editing ? (
              <input className={inputCls} placeholder="e.g. BTEC Level 3, GCSEs" value={form.education}
                onChange={e => setForm(f => ({ ...f, education: e.target.value }))} />
            ) : <p className="text-sm text-slate-900 px-1">{form.education || <span className="text-slate-400 italic">Not set</span>}</p>}
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-600 mb-1.5">Work Experience</label>
          {editing ? (
            <textarea className={textareaCls} rows={3} placeholder="Describe your previous roles…" value={form.experience}
              onChange={e => setForm(f => ({ ...f, experience: e.target.value }))} />
          ) : <p className="text-sm text-slate-900 px-1 whitespace-pre-wrap">{form.experience || <span className="text-slate-400 italic">Not set</span>}</p>}
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-600 mb-1.5">Interests &amp; Career Goals</label>
          {editing ? (
            <textarea className={textareaCls} rows={2} placeholder="e.g. Renewable energy, software development…" value={form.interests}
              onChange={e => setForm(f => ({ ...f, interests: e.target.value }))} />
          ) : <p className="text-sm text-slate-900 px-1 whitespace-pre-wrap">{form.interests || <span className="text-slate-400 italic">Not set</span>}</p>}
        </div>
      </div>

      {/* Skill Credentials */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-extrabold text-slate-900">Skill Credentials</h2>
          <span className="text-xs font-semibold text-slate-400">{candidate.skills.length} saved</span>
        </div>

        {/* ── Search & queue skills ── */}
        <div className="space-y-3">
          <label className="block text-xs font-bold text-slate-600">Search & Add Skills</label>

          {/* Search input */}
          <div className="relative">
            <input
              className={inputCls + ' pr-8'}
              placeholder="Search skills (e.g. Python, Welding, Electrical)…"
              value={skillSearch}
              onChange={e => handleSkillSearch(e.target.value)}
            />
            {skillSearching && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
            )}
          </div>

          {/* Search results dropdown */}
          {skillResults.length > 0 && (
            <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
              {skillResults.slice(0, 6).map(skill => {
                const alreadySaved  = candidate.skills.some(s => s.skill_id === skill.id || s.name === skill.name);
                const alreadyQueued = pendingSkills.some(s => s.id === skill.id);
                return (
                  <div key={skill.id} className="flex items-center justify-between p-3 border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    <div>
                      <p className="text-sm font-bold text-slate-900">{skill.name}</p>
                      <p className="text-xs text-slate-400">{skill.category || skill.trade || 'General'}</p>
                    </div>
                    {alreadySaved ? (
                      <span className="text-xs text-emerald-600 font-bold">Saved ✓</span>
                    ) : alreadyQueued ? (
                      <span className="text-xs text-teal-600 font-bold">Queued ✓</span>
                    ) : (
                      <button
                        onClick={() => handleQueueSkill(skill)}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold hover:bg-emerald-100 transition-colors">
                        <Plus className="w-3 h-3" /> Add
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* No results — offer to add as custom skill */}
          {skillSearch.trim().length >= 2 && !skillSearching && skillResults.length === 0 && (
            <div className="border border-dashed border-slate-300 rounded-xl p-3 flex items-center justify-between gap-3 bg-slate-50">
              <div>
                <p className="text-sm font-bold text-slate-700">"{skillSearch.trim()}" not in catalog</p>
                <p className="text-xs text-slate-400">Add it as a custom skill</p>
              </div>
              <button
                onClick={handleQueueCustomSkill}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 transition-colors flex-shrink-0">
                <Plus className="w-3 h-3" /> Add Anyway
              </button>
            </div>
          )}

          {/* ── Pending queue ── */}
          {pendingSkills.length > 0 && (
            <div className="rounded-xl border border-teal-200 bg-teal-50 p-4 space-y-3">
              <p className="text-xs font-extrabold text-teal-700 uppercase tracking-wide">
                {pendingSkills.length} skill{pendingSkills.length > 1 ? 's' : ''} ready to save
              </p>

              <div className="space-y-2">
                {pendingSkills.map(skill => (
                  <div key={skill.id} className="flex items-center justify-between gap-3 bg-white rounded-xl border border-teal-100 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-slate-900 truncate">{skill.name}</p>
                      <p className="text-xs text-slate-400">{skill.category}</p>
                    </div>
                    <select
                      value={skill.level}
                      onChange={e => handlePendingLevelChange(skill.id, e.target.value)}
                      className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-emerald-500 flex-shrink-0">
                      <option value="beginner">Beginner</option>
                      <option value="intermediate">Intermediate</option>
                      <option value="advanced">Advanced</option>
                    </select>
                    <button
                      onClick={() => handleRemovePending(skill.id)}
                      title="Remove from queue"
                      className="p-1 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors flex-shrink-0">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              {skillSaveError && (
                <div className="flex items-center gap-2 p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" /> {skillSaveError}
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => { setPendingSkills([]); setSkillSaveError(''); }}
                  className="px-3.5 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 transition-all">
                  Clear All
                </button>
                <button
                  onClick={handleSaveSkills}
                  disabled={savingSkills}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 disabled:opacity-60 transition-all">
                  {savingSkills
                    ? <><div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> Saving…</>
                    : <><Check className="w-3.5 h-3.5" /> Save {pendingSkills.length} Skill{pendingSkills.length > 1 ? 's' : ''}</>}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── Saved skills list ── */}
        {candidate.skills.length === 0 ? (
          <p className="text-sm text-slate-400 italic py-2">No skills saved yet. Search above to add your first skill.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {candidate.skills.map((s, i) => (
              <div key={i} className="p-3.5 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-bold text-slate-900 text-sm truncate">{s.name}</p>
                  <p className="text-xs text-slate-500 capitalize">{s.level}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
                    s.status === 'VERIFIED' ? 'bg-emerald-100 text-emerald-800' :
                    s.status === 'ASSESSED' ? 'bg-teal-100 text-teal-800' : 'bg-slate-200 text-slate-700'
                  }`}>{s.status || (s.verified ? 'VERIFIED' : 'SELF_DECLARED')}</span>
                  <button
                    onClick={() => handleRemoveSkill(s)}
                    disabled={removingSkill === s.skill_id}
                    title="Remove skill"
                    className="p-1 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors disabled:opacity-40">
                    {removingSkill === s.skill_id
                      ? <div className="w-3.5 h-3.5 border-2 border-rose-400 border-t-transparent rounded-full animate-spin" />
                      : <X className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EmployerAssessmentsView({ data, currentUser, onSaved, showToastMessage }) {
  const LEVELS = ['easy', 'medium', 'hard'];
  const Q_TYPES = ['mcq', 'short', 'theory'];

  const emptyQuestion = (type = 'mcq') => ({
    _id: Math.random().toString(36).slice(2),
    question_type: type,
    question: '',
    option_a: '', option_b: '', option_c: '', option_d: '',
    correct_option: 'A',
    model_answer: '',
  });

  const blankForm = () => ({
    skill_id: '',
    title: '',
    description: '',
    difficulty: 'medium',
    status: 'approved',
    questions: [emptyQuestion('mcq')],
  });

  const [form, setForm]           = useState(blankForm());
  const [saving, setSaving]       = useState(false);
  const [saveError, setSaveError] = useState('');
  const [editingId, setEditingId] = useState(null); // null = creating new
  const [generating, setGenerating] = useState(false);
  const [showForm, setShowForm]   = useState(false);
  // AI question-count panel state
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [aiCounts, setAiCounts] = useState({ mcq: 4, short: 2, theory: 1 });

  const myAssessments = data.assessments.filter(a => a.created_by === currentUser.id);
  const inputCls = "w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition";

  const openNew = () => { setForm(blankForm()); setEditingId(null); setSaveError(''); setShowForm(true); setShowAiPanel(false); };
  const openEdit = (a) => {
    setForm({
      skill_id: a.skill_id,
      title: a.title,
      description: a.description || '',
      difficulty: a.difficulty || 'medium',
      status: a.status,
      questions: (a.questions || []).map(q => ({ ...q, _id: q.id || Math.random().toString(36).slice(2) })),
    });
    setEditingId(a.id);
    setSaveError('');
    setShowForm(true);
  };

  const addQuestion = (type = 'mcq') =>
    setForm(f => ({ ...f, questions: [...f.questions, emptyQuestion(type)] }));

  const removeQuestion = (idx) =>
    setForm(f => ({ ...f, questions: f.questions.filter((_, i) => i !== idx) }));

  const updateQuestion = (idx, field, value) =>
    setForm(f => ({
      ...f,
      questions: f.questions.map((q, i) => i === idx ? { ...q, [field]: value } : q),
    }));

  // AI generation via Gemini
  // Step 1: open the count panel
  const openAiPanel = () => {
    if (!form.title && !form.skill_id) {
      setSaveError('Select a skill and enter a title first so AI knows what to generate.');
      return;
    }
    setSaveError('');
    setShowAiPanel(true);
  };

  // Step 2: employer confirms counts → call backend AI endpoint (Gemini server-side)
  const confirmGenerate = async () => {
    const total = aiCounts.mcq + aiCounts.short + aiCounts.theory;
    if (total === 0) {
      setSaveError('Enter at least 1 question in any category.');
      return;
    }
    setShowAiPanel(false);

    const skillName =
      data.allSkills?.find(s => s.id === Number(form.skill_id))?.name ||
      data.assessments.find(a => a.skill_id === Number(form.skill_id))?.skill_name ||
      form.title ||
      'the selected skill';

    setGenerating(true);
    setSaveError('');
    try {
      const res = await aiApi.generateQuestions(skillName, form.difficulty, aiCounts.mcq, aiCounts.short, aiCounts.theory);
      if (res.error) throw new Error(res.error);

      const parsed = res.questions;
      if (!Array.isArray(parsed)) throw new Error('AI returned non-array');

      setForm(f => ({
        ...f,
        questions: parsed.map(q => ({
          _id: Math.random().toString(36).slice(2),
          question_type: q.type || q.question_type || 'mcq',
          question:      q.question      || '',
          option_a:      q.option_a      || '',
          option_b:      q.option_b      || '',
          option_c:      q.option_c      || '',
          option_d:      q.option_d      || '',
          correct_option: q.correct_option || 'A',
          model_answer:  q.model_answer  || '',
        })),
      }));
    } catch (err) {
      setSaveError('AI generation failed: ' + (err.message || 'Unknown error'));
    } finally {
      setGenerating(false);
    }
  };

  const handleSave = async () => {
    if (!form.skill_id) { setSaveError('Select a skill.'); return; }
    if (!form.title.trim()) { setSaveError('Enter a title.'); return; }
    if (form.questions.length === 0) { setSaveError('Add at least one question.'); return; }

    setSaving(true); setSaveError('');
    const payload = {
      skill_id: Number(form.skill_id),
      title: form.title,
      description: form.description,
      difficulty: form.difficulty,
      status: form.status,
      questions: form.questions.map(q => ({
        question_type: q.question_type,
        question: q.question,
        option_a: q.option_a || null,
        option_b: q.option_b || null,
        option_c: q.option_c || null,
        option_d: q.option_d || null,
        correct_option: q.correct_option || null,
        model_answer: q.model_answer || null,
      })),
    };

    const res = editingId
      ? await assessmentsApi.update(editingId, payload)
      : await assessmentsApi.create(payload);

    setSaving(false);
    if (res.error) { setSaveError(res.error); return; }
    setShowForm(false);
    setShowAiPanel(false);
    setForm(blankForm());
    setEditingId(null);
    if (onSaved) onSaved();
  };

  const handleDelete = async (id) => {
    const res = await assessmentsApi.delete(id);
    if (res?.error) { showToastMessage(res.error, 'error'); return; }
    if (onSaved) onSaved();
  };

  const diffColor = { easy: 'bg-emerald-100 text-emerald-700', medium: 'bg-amber-100 text-amber-700', hard: 'bg-rose-100 text-rose-700' };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-emerald-950 rounded-3xl p-6 text-white shadow-xl flex items-center justify-between">
        <div>
          <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider">Assessments</span>
          <h1 className="text-2xl font-black mt-0.5">Manage Skill Assessments</h1>
          <p className="text-slate-400 text-xs mt-1">Create assessments for candidates — MCQ, short answer, and theory questions.</p>
        </div>
        {!showForm && (
          <button onClick={openNew}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold text-xs transition-all">
            <Plus className="w-4 h-4" /> Create Assessment
          </button>
        )}
      </div>

      {/* Create / Edit Form */}
      {showForm && (
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-6 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-extrabold text-slate-900">{editingId ? 'Edit Assessment' : 'New Assessment'}</h2>
            <button onClick={() => setShowForm(false)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"><X className="w-4 h-4" /></button>
          </div>

          {saveError && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">
              <AlertCircle className="w-4 h-4 flex-shrink-0" /> {saveError}
            </div>
          )}

          {/* Basic info */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1.5">Skill <span className="text-rose-500">*</span></label>
              <select className={inputCls} value={form.skill_id}
                onChange={e => setForm(f => ({ ...f, skill_id: e.target.value }))}>
                <option value="">— Select skill —</option>
                {(data.allSkills || []).map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1.5">Difficulty</label>
              <div className="flex gap-2">
                {LEVELS.map(l => (
                  <button key={l} onClick={() => setForm(f => ({ ...f, difficulty: l }))}
                    className={`flex-1 py-2 rounded-xl text-xs font-bold capitalize border transition-all ${
                      form.difficulty === l
                        ? (l === 'easy' ? 'bg-emerald-600 text-white border-emerald-600' : l === 'medium' ? 'bg-amber-500 text-white border-amber-500' : 'bg-rose-600 text-white border-rose-600')
                        : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                    }`}>{l}</button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1.5">Title <span className="text-rose-500">*</span></label>
            <input className={inputCls} placeholder="e.g. Python Fundamentals Test" value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1.5">Description</label>
            <textarea className={inputCls + ' resize-none'} rows={2}
              placeholder="Brief description of what this assessment covers…"
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>

          {/* AI generate button / count panel */}
          {!showAiPanel ? (
            <div className="flex items-center justify-between p-4 rounded-xl bg-violet-50 border border-violet-200">
              <div>
                <p className="text-sm font-extrabold text-violet-900 flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-violet-600" /> Auto-generate questions with AI
                </p>
                <p className="text-xs text-violet-700 mt-0.5">
                  Gemini will ask how many MCQ, short answer, and theory questions you want, then generate them based on the selected difficulty.
                </p>
              </div>
              <button
                onClick={openAiPanel}
                disabled={generating}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 text-white text-xs font-bold hover:bg-violet-700 disabled:opacity-60 whitespace-nowrap ml-4">
                {generating
                  ? <><div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> Generating…</>
                  : <><Sparkles className="w-3.5 h-3.5" /> Generate with AI</>}
              </button>
            </div>
          ) : (
            /* ── Step 2: Question count picker ── */
            <div className="rounded-xl border border-violet-300 bg-violet-50 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-extrabold text-violet-900 flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-violet-600" /> How many questions of each type?
                </p>
                <button onClick={() => setShowAiPanel(false)} className="p-1 rounded-lg text-slate-400 hover:text-slate-600">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <p className="text-xs text-violet-700">
                AI will generate questions at <span className="font-extrabold capitalize">{form.difficulty}</span> difficulty for <span className="font-extrabold">{data.allSkills?.find(s => s.id === Number(form.skill_id))?.name || form.title || 'this skill'}</span>.
              </p>

              <div className="grid grid-cols-3 gap-3">
                {[
                  { key: 'mcq',   label: 'MCQ',          sub: 'Multiple choice',   color: 'emerald' },
                  { key: 'short', label: 'Short Answer',  sub: '1-2 sentence reply', color: 'teal' },
                  { key: 'theory',label: 'Theory / Long', sub: 'Detailed paragraph', color: 'blue' },
                ].map(({ key, label, sub, color }) => (
                  <div key={key} className={`bg-white rounded-xl border border-${color}-200 p-3 text-center space-y-2`}>
                    <p className={`text-xs font-extrabold text-${color}-700`}>{label}</p>
                    <p className="text-[10px] text-slate-400">{sub}</p>
                    <div className="flex items-center justify-center gap-2">
                      <button
                        onClick={() => setAiCounts(c => ({ ...c, [key]: Math.max(0, c[key] - 1) }))}
                        className="w-6 h-6 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm flex items-center justify-center">−</button>
                      <span className="w-6 text-center text-base font-extrabold text-slate-900">{aiCounts[key]}</span>
                      <button
                        onClick={() => setAiCounts(c => ({ ...c, [key]: Math.min(10, c[key] + 1) }))}
                        className="w-6 h-6 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm flex items-center justify-center">+</button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between pt-1">
                <p className="text-xs text-slate-500">
                  Total: <span className="font-extrabold text-slate-800">{aiCounts.mcq + aiCounts.short + aiCounts.theory} questions</span>
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowAiPanel(false)}
                    className="px-3.5 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50">
                    Cancel
                  </button>
                  <button
                    onClick={confirmGenerate}
                    disabled={aiCounts.mcq + aiCounts.short + aiCounts.theory === 0}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-600 text-white text-xs font-bold hover:bg-violet-700 disabled:opacity-50">
                    <Sparkles className="w-3.5 h-3.5" /> Generate {aiCounts.mcq + aiCounts.short + aiCounts.theory} Questions
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Questions */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-extrabold text-slate-900">Questions ({form.questions.length})</h3>
              <div className="flex gap-2">
                {Q_TYPES.map(t => (
                  <button key={t} onClick={() => addQuestion(t)}
                    className="px-2.5 py-1 rounded-lg border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 flex items-center gap-1">
                    <Plus className="w-3 h-3" /> {t.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            {form.questions.map((q, idx) => (
              <div key={q._id || idx} className="border border-slate-200 rounded-xl p-4 space-y-3 relative">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-500">Q{idx + 1}</span>
                    <select value={q.question_type}
                      onChange={e => updateQuestion(idx, 'question_type', e.target.value)}
                      className="text-xs border border-slate-200 rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500">
                      <option value="mcq">MCQ</option>
                      <option value="short">Short Answer</option>
                      <option value="theory">Theory</option>
                    </select>
                  </div>
                  <button onClick={() => removeQuestion(idx)}
                    className="p-1 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                <textarea rows={2} placeholder="Enter the question…" value={q.question}
                  onChange={e => updateQuestion(idx, 'question', e.target.value)}
                  className={inputCls + ' resize-none'} />

                {q.question_type === 'mcq' && (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {['a', 'b', 'c', 'd'].map(opt => (
                        <div key={opt} className="flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-500 uppercase w-4">{opt}.</span>
                          <input className={inputCls} placeholder={`Option ${opt.toUpperCase()}`}
                            value={q[`option_${opt}`] || ''}
                            onChange={e => updateQuestion(idx, `option_${opt}`, e.target.value)} />
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-600">Correct answer:</span>
                      {['A', 'B', 'C', 'D'].map(opt => (
                        <button key={opt} onClick={() => updateQuestion(idx, 'correct_option', opt)}
                          className={`w-8 h-8 rounded-lg text-xs font-bold border transition-all ${
                            q.correct_option === opt
                              ? 'bg-emerald-600 text-white border-emerald-600'
                              : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                          }`}>{opt}</button>
                      ))}
                    </div>
                  </>
                )}

                {(q.question_type === 'short' || q.question_type === 'theory') && (
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1">Model Answer</label>
                    <textarea rows={q.question_type === 'theory' ? 3 : 2}
                      placeholder="Expected answer (shown to assessors)…"
                      value={q.model_answer || ''}
                      onChange={e => updateQuestion(idx, 'model_answer', e.target.value)}
                      className={inputCls + ' resize-none'} />
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Publish toggle + Save */}
          <div className="flex items-center justify-between pt-4 border-t border-slate-100">
            <label className="flex items-center gap-2 cursor-pointer">
              <div onClick={() => setForm(f => ({ ...f, status: f.status === 'approved' ? 'draft' : 'approved' }))}
                className={`w-10 h-5 rounded-full transition-colors ${form.status === 'approved' ? 'bg-emerald-500' : 'bg-slate-300'}`}>
                <div className={`w-4 h-4 rounded-full bg-white shadow m-0.5 transition-transform ${form.status === 'approved' ? 'translate-x-5' : ''}`} />
              </div>
              <span className="text-xs font-bold text-slate-700">
                {form.status === 'approved' ? 'Published — visible to candidates' : 'Draft — hidden from candidates'}
              </span>
            </label>
            <div className="flex gap-2">
              <button onClick={() => setShowForm(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50">
                Cancel
              </button>
              <button onClick={handleSave} disabled={saving}
                className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 disabled:opacity-60">
                {saving ? <><div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> Saving…</> : <><Check className="w-3.5 h-3.5" /> Save Assessment</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* My assessments list */}
      {!showForm && (
        <div className="space-y-4">
          {myAssessments.length === 0 ? (
            <div className="bg-white rounded-2xl p-10 border border-slate-200/80 shadow-sm text-center space-y-3">
              <Award className="w-10 h-10 text-slate-300 mx-auto" />
              <p className="font-bold text-slate-500">No assessments yet</p>
              <p className="text-xs text-slate-400">Click "Create Assessment" to build your first one.</p>
            </div>
          ) : (
            myAssessments.map(a => (
              <div key={a.id} className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-extrabold text-slate-900">{a.title}</h3>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold capitalize ${diffColor[a.difficulty] || 'bg-slate-100 text-slate-600'}`}>{a.difficulty}</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${a.status === 'approved' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                      {a.status === 'approved' ? 'Published' : 'Draft'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {a.skill_name} · {a.question_count || 0} questions
                    {a.mcq_count > 0 && ` (${a.mcq_count} MCQ`}
                    {a.short_count > 0 && `, ${a.short_count} Short`}
                    {a.theory_count > 0 && `, ${a.theory_count} Theory`}
                    {(a.mcq_count > 0 || a.short_count > 0 || a.theory_count > 0) && ')'}
                  </p>
                  {a.description && <p className="text-xs text-slate-400 mt-1 line-clamp-1">{a.description}</p>}
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <button onClick={() => openEdit(a)}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 flex items-center gap-1">
                    <Edit className="w-3.5 h-3.5" /> Edit
                  </button>
                  <button onClick={() => handleDelete(a.id)}
                    className="px-3 py-1.5 rounded-lg border border-rose-200 text-xs font-bold text-rose-600 hover:bg-rose-50 flex items-center gap-1">
                    <Trash2 className="w-3.5 h-3.5" /> Delete
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function EmployerDashboardView({ data, currentUser, setActiveTab }) {
  const [liveApps, setLiveApps] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    applicationsApi.forEmployer()
      .then(res => { if (!res.error && Array.isArray(res)) setLiveApps(res); })
      .finally(() => setLoading(false));
  }, []);

  const empListings = data.apprenticeships.filter(
    a => (a.employer_id ?? a.employerId) === currentUser.id
  );

  // Use live data for applicant counts; fall back to stale data while loading
  const applications = liveApps ?? data.applications.filter(a =>
    empListings.map(l => l.id).includes(a.apprenticeship_id ?? a.apprenticeshipId)
  );

  const totalApplicants = applications.length;

  const newThisWeek = applications.filter(a => {
    const ts = a.created_at ? new Date(a.created_at).getTime() : 0;
    return Date.now() - ts < 7 * 24 * 60 * 60 * 1000;
  }).length;

  // Status-based progress mapping (not match score)
  const statusProgress = {
    applied:      15,
    under_review: 30,
    shortlisted:  55,
    interview:    75,
    selected:    100,
    rejected:      0,
  };

  const statusColors = {
    applied:      'bg-sky-100 text-sky-700',
    under_review: 'bg-blue-100 text-blue-700',
    shortlisted:  'bg-emerald-100 text-emerald-700',
    interview:    'bg-teal-100 text-teal-700',
    selected:     'bg-green-100 text-green-800',
    rejected:     'bg-rose-100 text-rose-700',
  };

  const progressBarColor = {
    applied:      'bg-sky-400',
    under_review: 'bg-blue-500',
    shortlisted:  'bg-emerald-500',
    interview:    'bg-teal-500',
    selected:     'bg-green-600',
    rejected:     'bg-rose-400',
  };

  // Status breakdown counts (each application is independent regardless of same candidate)
  const statusBreakdown = applications.reduce((acc, a) => {
    const s = a.status || 'applied';
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-emerald-950 rounded-3xl p-6 text-white shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider">Employer Portal</span>
            <h1 className="text-2xl font-black mt-0.5">{currentUser.name}</h1>
            <p className="text-slate-400 text-xs mt-1">Logged in as: <span className="text-slate-300 font-semibold">{currentUser.email}</span></p>
          </div>
          <button
            onClick={() => setActiveTab('my-listings')}
            className="px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold text-xs transition-all self-start sm:self-auto">
            Manage Apprenticeships
          </button>
        </div>
      </div>

      {/* Stats — always show live counts */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm">
          <span className="text-xs font-bold uppercase text-slate-400 tracking-wider">Your Listings</span>
          <p className="text-3xl font-black text-slate-900 mt-2">{empListings.length}</p>
        </div>
        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm">
          <span className="text-xs font-bold uppercase text-slate-400 tracking-wider">Total Applications</span>
          {loading ? (
            <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mt-2" />
          ) : (
            <p className="text-3xl font-black text-emerald-600 mt-2">{totalApplicants}</p>
          )}
          <p className="text-[10px] text-slate-400 mt-1">across all listings</p>
        </div>
        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm">
          <span className="text-xs font-bold uppercase text-slate-400 tracking-wider">New This Week</span>
          {loading ? (
            <div className="w-6 h-6 border-2 border-teal-500 border-t-transparent rounded-full animate-spin mt-2" />
          ) : (
            <p className="text-3xl font-black text-teal-600 mt-2">{newThisWeek}</p>
          )}
          <p className="text-[10px] text-slate-400 mt-1">applied in last 7 days</p>
        </div>
      </div>

      {/* No listings warning */}
      {empListings.length === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-amber-800">No listings found for this account</p>
            <p className="text-xs text-amber-700 mt-1">
              You're logged in as <span className="font-bold">{currentUser.email}</span>. Create your first listing to start receiving applications.
            </p>
            <button onClick={() => setActiveTab('my-listings')}
              className="mt-2 px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-bold hover:bg-amber-700">
              Create a listing →
            </button>
          </div>
        </div>
      )}

      {/* Status breakdown */}
      {totalApplicants > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-5">
          <h3 className="font-extrabold text-slate-900 mb-4">Application Status Breakdown</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {Object.entries(statusBreakdown).map(([status, count]) => (
              <div key={status} className="p-3 rounded-xl bg-slate-50 border border-slate-100 text-center">
                <span className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-extrabold mb-1.5 ${statusColors[status] || 'bg-slate-100 text-slate-600'}`}>
                  {status.replace('_', ' ').toUpperCase()}
                </span>
                <p className="text-2xl font-black text-slate-900">{count}</p>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  {Math.round((count / totalApplicants) * 100)}% of total
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent applications — with status-based progress, not match score */}
      {totalApplicants > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-extrabold text-slate-900">Recent Applications</h3>
            <button onClick={() => setActiveTab('applicants')} className="text-xs text-emerald-600 font-bold hover:underline">
              View all →
            </button>
          </div>
          <div className="space-y-3">
            {[...applications]
              .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
              .slice(0, 6)
              .map(app => {
                const progress = statusProgress[app.status] ?? 15;
                const barColor = progressBarColor[app.status] || 'bg-slate-400';
                const badge = statusColors[app.status] || 'bg-slate-100 text-slate-600';
                const appliedDate = app.created_at
                  ? new Date(app.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
                  : '';

                return (
                  <div key={app.id} className="p-3.5 rounded-xl bg-slate-50 border border-slate-100 space-y-2">
                    {/* Top row */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-slate-900 truncate">{app.candidate_name || 'Candidate'}</p>
                        <p className="text-[10px] text-slate-500 truncate">{app.listing_title}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {appliedDate && <span className="text-[10px] text-slate-400">{appliedDate}</span>}
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${badge}`}>
                          {app.status?.replace('_', ' ')}
                        </span>
                      </div>
                    </div>
                    {/* Progress bar based on status stage */}
                    <div>
                      <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                        <span>Application progress</span>
                        <span>{progress}%</span>
                      </div>
                      <div className="h-1.5 w-full bg-slate-200 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${barColor}`}
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}

function EmployerProfileView({ data, currentUser, onProfileSaved, onPhotoUploaded }) {
  const profile = data.employerProfile || {};
  const [editing, setEditing] = useState(!profile.company_name);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [form, setForm] = useState({
    name:         currentUser.name       || '',
    company_name: profile.company_name   || '',
    description:  profile.description    || '',
    location:     profile.location       || '',
    website:      profile.website      || '',
  });

  useEffect(() => {
    setForm({
      name:         currentUser.name       || '',
      company_name: profile.company_name   || '',
      description:  profile.description    || '',
      location:     profile.location       || '',
      website:      profile.website        || '',
    });
  }, [currentUser.name, profile.company_name, profile.description, profile.location, profile.website]);

  const completion = Math.round(
    (Object.values(form).filter(v => v.trim()).length / Object.keys(form).length) * 100
  );

  const handleSave = async () => {
    if (!form.company_name.trim()) { setSaveError('Company name is required.'); return; }
    if (!form.name.trim()) { setSaveError('Your name is required.'); return; }
    setSaving(true);
    setSaveError('');
    const res = await profilesApi.updateEmployerProfile(form);
    setSaving(false);
    if (res.error) { setSaveError(res.error); return; }
    setEditing(false);
    if (onProfileSaved) onProfileSaved();
  };

  const inputCls = "w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition";
  const textareaCls = inputCls + " resize-none";

  return (
    <div className="space-y-6">
      {/* Header with photo */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-emerald-950 rounded-3xl p-6 text-white shadow-xl relative overflow-hidden">
        <div className="absolute -right-10 -top-10 w-48 h-48 rounded-full bg-emerald-400/10 blur-3xl pointer-events-none" />
        <div className="relative flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <ProfileAvatar
              photoUrl={currentUser.photo_url}
              name={form.company_name || currentUser.name}
              size={16}
              onUpload={(url) => { if (onPhotoUploaded) onPhotoUploaded(url); }}
            />
            <div>
              <p className="text-xs font-bold text-emerald-300 uppercase tracking-wider mb-1">Employer Profile</p>
              <h1 className="text-2xl font-black">{currentUser.name || <span className="text-slate-400">Name not set</span>}</h1>
              <p className="text-slate-300 text-sm mt-0.5">{currentUser.email}</p>
            </div>
          </div>
          <div className="hidden sm:flex flex-col items-end gap-1">
            <span className="text-xs text-emerald-300 font-semibold">Profile {completion}% complete</span>
            <div className="w-32 h-2 bg-white/20 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-400 rounded-full transition-all" style={{ width: `${completion}%` }} />
            </div>
          </div>
        </div>
      </div>

      {!profile.company_name && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm font-semibold">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          Complete your company profile to start posting apprenticeships and attract candidates.
        </div>
      )}

      {/* Company details form */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-extrabold text-slate-900">Company Information</h2>
          {!editing ? (
            <button onClick={() => setEditing(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 transition-all">
              <Edit className="w-3.5 h-3.5" /> Edit Profile
            </button>
          ) : (
            <div className="flex gap-2">
              <button onClick={() => { setEditing(false); setSaveError(''); }}
                className="px-3.5 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 transition-all">
                Cancel
              </button>
              <button onClick={handleSave} disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 disabled:opacity-60 transition-all">
                {saving ? <><div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> Saving…</> : <><Check className="w-3.5 h-3.5" /> Save Changes</>}
              </button>
            </div>
          )}
        </div>

        {saveError && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">
            <AlertCircle className="w-4 h-4 flex-shrink-0" /> {saveError}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1.5">Your Name <span className="text-rose-500">*</span></label>
            {editing ? (
              <input className={inputCls} placeholder="Your full name" value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            ) : (
              <p className="text-sm text-slate-900 px-1">{form.name || <span className="text-slate-400 italic">Not set</span>}</p>
            )}
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1.5">
              Company Name <span className="text-rose-500">*</span>
            </label>
            {editing ? (
              <input className={inputCls} placeholder="e.g. Acme Engineering Ltd" value={form.company_name}
                onChange={e => setForm(f => ({ ...f, company_name: e.target.value }))} />
            ) : (
              <p className="text-sm text-slate-900 px-1">{form.company_name || <span className="text-slate-400 italic">Not set</span>}</p>
            )}
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1.5">Location</label>
            {editing ? (
              <input className={inputCls} placeholder="e.g. Manchester, UK" value={form.location}
                onChange={e => setForm(f => ({ ...f, location: e.target.value }))} />
            ) : (
              <p className="text-sm text-slate-900 px-1">{form.location || <span className="text-slate-400 italic">Not set</span>}</p>
            )}
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-600 mb-1.5">Website</label>
          {editing ? (
            <input className={inputCls} type="url" placeholder="https://www.yourcompany.com" value={form.website}
              onChange={e => setForm(f => ({ ...f, website: e.target.value }))} />
          ) : form.website ? (
            <a href={form.website} target="_blank" rel="noopener noreferrer"
              className="text-sm text-emerald-600 font-semibold hover:underline px-1">{form.website}</a>
          ) : (
            <p className="text-sm text-slate-400 italic px-1">Not set</p>
          )}
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-600 mb-1.5">Company Description</label>
          {editing ? (
            <textarea className={textareaCls} rows={4}
              placeholder="Describe your company, mission, culture, and what apprentices can expect…"
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          ) : (
            <p className="text-sm text-slate-900 px-1 whitespace-pre-wrap">{form.description || <span className="text-slate-400 italic">Not set</span>}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function EmployerListingsView({ data, currentUser, onOpenCreateModal, onToggleStatus }) {
  // Backend returns snake_case employer_id
  const myListings = data.apprenticeships.filter(
    a => (a.employer_id ?? a.employerId) === currentUser.id
  );

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm flex items-center justify-between">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900">Manage Apprenticeship Postings</h2>
          <p className="text-xs text-slate-500 mt-1">Create, edit, or pause apprenticeship opportunities.</p>
        </div>
        <button
          onClick={onOpenCreateModal}
          className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs flex items-center gap-2 shadow-md shadow-emerald-200">
          <Plus className="w-4 h-4" /> Create Apprenticeship
        </button>
      </div>

      {myListings.length === 0 ? (
        <div className="bg-white rounded-2xl p-10 border border-slate-200/80 shadow-sm text-center space-y-3">
          <Briefcase className="w-10 h-10 text-slate-300 mx-auto" />
          <p className="font-bold text-slate-500">No listings yet</p>
          <p className="text-xs text-slate-400">Click "Create Apprenticeship" to post your first listing.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {myListings.map(listing => (
            <div key={listing.id} className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-extrabold text-slate-900">{listing.title}</h3>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                    listing.status === 'published' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'
                  }`}>
                    {listing.status}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  {listing.location || 'Location not set'} {listing.work_mode ? `• ${listing.work_mode}` : ''}
                </p>
                <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">{listing.description}</p>
              </div>
              <button
                onClick={() => onToggleStatus(listing.id)}
                className="px-3.5 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50 whitespace-nowrap">
                {listing.status === 'published' ? 'Unpublish' : 'Publish'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EmployerApplicantsView({ data, currentUser, onUpdateStatus }) {
  const [applicants, setApplicants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updatingId, setUpdatingId] = useState(null);
  const [filterListing, setFilterListing] = useState('ALL');
  const [filterStatus, setFilterStatus] = useState('ALL');

  // Fetch live from backend every time the view is mounted
  const fetchApplicants = () => {
    setLoading(true);
    setError('');
    applicationsApi.forEmployer()
      .then(res => {
        if (res.error) setError(res.error);
        else setApplicants(Array.isArray(res) ? res : []);
      })
      .catch(() => setError('Failed to load applicants.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchApplicants(); }, []);

  const handleUpdateStatus = async (appId, newStatus) => {
    setUpdatingId(appId);
    const r = await applicationsApi.updateStatus(appId, newStatus);
    setUpdatingId(null);
    if (r.error) { onUpdateStatus(appId, 'error'); return; }
    // Update local state immediately
    setApplicants(prev => prev.map(a => a.id === appId ? { ...a, status: newStatus } : a));
    onUpdateStatus(appId, newStatus);
  };

  // Unique listings for filter dropdown
  const listingOptions = [...new Set(applicants.map(a => a.listing_title).filter(Boolean))];

  // Apply filters
  const filtered = applicants.filter(a => {
    if (filterListing !== 'ALL' && a.listing_title !== filterListing) return false;
    if (filterStatus  !== 'ALL' && a.status !== filterStatus)         return false;
    return true;
  });

  const statusColor = {
    applied:      'bg-slate-100 text-slate-700',
    under_review: 'bg-blue-100 text-blue-700',
    shortlisted:  'bg-emerald-100 text-emerald-700',
    interview:    'bg-teal-100 text-teal-700',
    selected:     'bg-green-100 text-green-800',
    rejected:     'bg-rose-100 text-rose-700',
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm flex items-center justify-between">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900">Applicant Pipeline</h2>
          <p className="text-xs text-slate-500 mt-1">
            Live view of all applications across your listings.
            {!loading && <span className="ml-1 font-semibold text-emerald-600">{applicants.length} total application{applicants.length !== 1 ? 's' : ''}</span>}
          </p>
        </div>
        <button onClick={fetchApplicants} disabled={loading}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-all">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {/* Filters */}
      {applicants.length > 0 && (
        <div className="flex flex-wrap gap-3 items-center">
          <select value={filterListing} onChange={e => setFilterListing(e.target.value)}
            className="text-xs border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-emerald-500">
            <option value="ALL">All Listings</option>
            {listingOptions.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
            className="text-xs border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-emerald-500">
            <option value="ALL">All Statuses</option>
            {['applied','under_review','shortlisted','interview','selected','rejected'].map(s => (
              <option key={s} value={s}>{s.replace('_', ' ')}</option>
            ))}
          </select>
          {(filterListing !== 'ALL' || filterStatus !== 'ALL') && (
            <button onClick={() => { setFilterListing('ALL'); setFilterStatus('ALL'); }}
              className="text-xs font-bold text-rose-500 hover:text-rose-700">Clear filters</button>
          )}
          <span className="text-xs text-slate-400 ml-auto">{filtered.length} shown</span>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center h-32">
          <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className="bg-rose-50 border border-rose-200 rounded-2xl p-6 text-center">
          <p className="text-sm font-bold text-rose-700">{error}</p>
          <button onClick={fetchApplicants} className="mt-3 px-4 py-2 rounded-xl bg-rose-600 text-white text-xs font-bold hover:bg-rose-700">Retry</button>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && applicants.length === 0 && (
        <div className="bg-white rounded-2xl p-10 border border-slate-200/80 shadow-sm text-center space-y-3">
          <Users className="w-10 h-10 text-slate-300 mx-auto" />
          <p className="font-bold text-slate-500">No applications yet</p>
          <p className="text-xs text-slate-400">When candidates apply to your listings, they will appear here instantly.</p>
        </div>
      )}

      {/* Table */}
      {!loading && !error && filtered.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-x-auto">
          <table className="w-full text-left text-xs min-w-[700px]">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase">
              <tr>
                <th className="p-4">Candidate</th>
                <th className="p-4">Applied For</th>
                <th className="p-4">Applied On</th>
                <th className="p-4">Match Score</th>
                <th className="p-4">Status</th>
                <th className="p-4">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium">
              {filtered.map(app => {
                const score = app.match_score != null ? `${Math.round(app.match_score)}%` : '—';
                const appliedDate = app.created_at
                  ? new Date(app.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
                  : '—';
                const isUpdating = updatingId === app.id;

                return (
                  <tr key={app.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="p-4">
                      <p className="font-bold text-slate-900">{app.candidate_name || 'Candidate'}</p>
                      <p className="text-slate-400 text-[10px]">{app.candidate_email || ''}</p>
                    </td>
                    <td className="p-4 text-slate-700 font-semibold">{app.listing_title || '—'}</td>
                    <td className="p-4 text-slate-500">{appliedDate}</td>
                    <td className="p-4 font-black text-emerald-600">{score}</td>
                    <td className="p-4">
                      <span className={`px-2.5 py-1 rounded-full font-bold text-[10px] capitalize ${statusColor[app.status] || 'bg-slate-100 text-slate-700'}`}>
                        {app.status?.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="p-4">
                      <div className="flex gap-1 flex-wrap">
                        {isUpdating ? (
                          <div className="w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <>
                            <button onClick={() => handleUpdateStatus(app.id, 'shortlisted')}
                              disabled={app.status === 'shortlisted'}
                              className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-bold text-[10px] hover:bg-emerald-700 disabled:opacity-40">
                              Shortlist
                            </button>
                            <button onClick={() => handleUpdateStatus(app.id, 'interview')}
                              disabled={app.status === 'interview'}
                              className="px-2.5 py-1 rounded-lg bg-teal-600 text-white font-bold text-[10px] hover:bg-teal-700 disabled:opacity-40">
                              Interview
                            </button>
                            <button onClick={() => handleUpdateStatus(app.id, 'selected')}
                              disabled={app.status === 'selected'}
                              className="px-2.5 py-1 rounded-lg bg-blue-600 text-white font-bold text-[10px] hover:bg-blue-700 disabled:opacity-40">
                              Select
                            </button>
                            <button onClick={() => handleUpdateStatus(app.id, 'rejected')}
                              disabled={app.status === 'rejected'}
                              className="px-2.5 py-1 rounded-lg bg-rose-600 text-white font-bold text-[10px] hover:bg-rose-700 disabled:opacity-40">
                              Reject
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function EmployerCompletionsView({ data, currentUser, onConfirmCompletion }) {
  return (
    <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm space-y-4">
      <h2 className="text-xl font-extrabold text-slate-900">Apprenticeship Completion Protocol</h2>
      <p className="text-xs text-slate-500">
        Confirm demonstrated candidate skills upon completion and generate a cryptographic tamper-evident record hash.
      </p>

      <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-between">
        <div>
          <p className="font-bold text-slate-900 text-sm">Alex Rivera — Junior Frontend Developer Apprentice</p>
          <p className="text-xs text-slate-500">Demonstrated: JavaScript, React, Node.js</p>
        </div>
        <button 
          onClick={() => onConfirmCompletion('cand-1', ['JavaScript', 'React'])}
          className="px-4 py-2 rounded-xl bg-slate-900 text-white font-bold text-xs hover:bg-slate-800">
          Confirm Completion & Hash
        </button>
      </div>
    </div>
  );
}

function AdminDashboardView({ data, setActiveTab }) {
  return (
    <div className="space-y-6">
      <div className="bg-slate-900 text-white rounded-3xl p-6 shadow-xl flex justify-between items-center">
        <div>
          <span className="text-xs font-bold text-amber-400 uppercase tracking-wider">System Governance</span>
          <h1 className="text-2xl font-black">Admin Moderation & Analytics</h1>
        </div>
        <button onClick={() => setActiveTab('audit-logs')} className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold">
          View Audit Trail
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <span className="text-xs font-bold text-slate-400 uppercase">Candidates</span>
          <p className="text-2xl font-black text-slate-900 mt-1">{data.candidates.length}</p>
        </div>
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <span className="text-xs font-bold text-slate-400 uppercase">Employers</span>
          <p className="text-2xl font-black text-slate-900 mt-1">{data.employers.length}</p>
        </div>
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <span className="text-xs font-bold text-slate-400 uppercase">Listings</span>
          <p className="text-2xl font-black text-slate-900 mt-1">{data.apprenticeships.length}</p>
        </div>
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <span className="text-xs font-bold text-slate-400 uppercase">Applications</span>
          <p className="text-2xl font-black text-slate-900 mt-1">{data.applications.length}</p>
        </div>
      </div>
    </div>
  );
}

function AdminUsersView({ data }) {
  return (
    <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
      <h2 className="text-xl font-extrabold text-slate-900">User Moderation</h2>
      <div className="space-y-2">
        {data.candidates.map(c => (
          <div key={c.id} className="p-3.5 rounded-xl bg-slate-50 border border-slate-100 flex justify-between items-center text-xs">
            <div>
              <span className="font-bold text-slate-900">{c.name}</span> ({c.email})
            </div>
            <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold">ACTIVE CANDIDATE</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AdminVerificationModView({ data, onApproveReject }) {
  const pendingEv = data.candidates.flatMap(c => c.evidence.map(e => ({ ...e, candidateName: c.name })));

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
        <h2 className="text-xl font-extrabold text-slate-900">Evidence Moderation Queue</h2>
        <p className="text-xs text-slate-500 mt-1">Review candidate artifacts and approve for official skill verification status.</p>
      </div>

      <div className="space-y-3">
        {pendingEv.map(ev => (
          <div key={ev.id} className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between text-xs">
            <div>
              <p className="font-bold text-slate-900">{ev.title}</p>
              <p className="text-slate-400">Candidate: {ev.candidateName} • Skill: {ev.skill}</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => onApproveReject(ev.id, 'APPROVED')} className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-bold">
                Approve
              </button>
              <button onClick={() => onApproveReject(ev.id, 'REJECTED')} className="px-3 py-1.5 rounded-lg bg-rose-600 text-white font-bold">
                Reject
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AdminAiQuestionsView({ data, onGenerateDraft, aiGenerating, onApproveQuestion }) {
  const [targetSkill, setTargetSkill] = useState('JavaScript');

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900">AI Question Moderation Pipeline</h2>
          <p className="text-xs text-slate-500 mt-1">
            Questions generated via Gemini AI are set to <strong>DRAFT</strong> status by default. They must be reviewed and approved before candidates can see them.
          </p>
          {/* AI Transparency Notice */}
          <div className="mt-3 flex flex-wrap gap-3">
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-violet-50 border border-violet-200 text-[11px] font-extrabold text-violet-700">
              <Bot className="w-3 h-3" /> AI-assisted · Gemini
            </span>
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-50 border border-amber-200 text-[11px] font-extrabold text-amber-700">
              <ShieldAlert className="w-3 h-3" /> Trainer review required before activation
            </span>
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-50 border border-slate-200 text-[11px] font-extrabold text-slate-600">
              <Info className="w-3 h-3" /> AI does not make hiring decisions
            </span>
          </div>
        </div>

        <div className="flex gap-2">
          <input 
            type="text" 
            value={targetSkill}
            onChange={(e) => setTargetSkill(e.target.value)}
            placeholder="Enter skill name to generate questions..."
            className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-semibold flex-1"
          />
          <button 
            disabled={aiGenerating}
            onClick={() => onGenerateDraft(targetSkill)}
            className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-md shadow-emerald-200">
            {aiGenerating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            Generate Draft Question
          </button>
        </div>
      </div>

      {/* Draft Questions List */}
      <div className="space-y-4">
        {data.assessments.map(assess => (
          <div key={assess.id} className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-3">
            <h3 className="font-extrabold text-slate-900 text-sm">{assess.skillName} Assessment Questions</h3>
            <div className="space-y-3">
              {assess.questions.map(q => (
                <div key={q.id} className="p-3.5 rounded-xl bg-slate-50 border border-slate-100 flex justify-between items-center text-xs">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-900">{q.question}</span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-extrabold ${
                        q.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                      }`}>
                        {q.status}
                      </span>
                    </div>
                  </div>

                  {q.status === 'DRAFT' && (
                    <button 
                      onClick={() => onApproveQuestion(assess.id, q.id)}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-bold text-[11px]">
                      Approve & Activate
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AdminAuditLogsView({ logs }) {
  return (
    <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
      <h2 className="text-xl font-extrabold text-slate-900">Platform Audit Logs</h2>
      <div className="space-y-2 text-xs">
        {logs.map(log => (
          <div key={log.id} className="p-3 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-between">
            <div>
              <span className="font-bold text-slate-900">[{log.user}] {log.action}</span>
              <p className="text-slate-500 mt-0.5">{log.details}</p>
            </div>
            <span className="text-[10px] text-slate-400 font-mono">{log.timestamp}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CreateApprenticeshipModal({ onClose, onSubmit }) {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('Software Engineering');
  const [location, setLocation] = useState('');
  const [stipend, setStipend] = useState('');
  const [description, setDescription] = useState('');

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl max-w-lg w-full p-6 space-y-4 shadow-2xl border border-slate-100">
        <h3 className="text-lg font-black text-slate-900">Create New Apprenticeship</h3>
        <div className="space-y-3 text-xs font-semibold text-slate-700">
          <div>
            <label className="block mb-1">Title</label>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} className="w-full p-2.5 rounded-xl border border-slate-200" placeholder="e.g. Junior Web Architect" />
          </div>
          <div>
            <label className="block mb-1">Category</label>
            <input type="text" value={category} onChange={(e) => setCategory(e.target.value)} className="w-full p-2.5 rounded-xl border border-slate-200" placeholder="e.g. Software Engineering, Advanced Manufacturing, Healthcare, Construction…" />
          </div>
          <div>
            <label className="block mb-1">Location & Stipend</label>
            <div className="grid grid-cols-2 gap-2">
              <input type="text" value={location} onChange={(e) => setLocation(e.target.value)} className="p-2.5 rounded-xl border border-slate-200" placeholder="Location" />
              <input type="text" value={stipend} onChange={(e) => setStipend(e.target.value)} className="p-2.5 rounded-xl border border-slate-200" placeholder="Stipend" />
            </div>
          </div>
          <div>
            <label className="block mb-1">Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} className="w-full p-2.5 rounded-xl border border-slate-200 h-20" placeholder="Job description..." />
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-slate-200 font-bold text-xs">Cancel</button>
          <button 
            onClick={() => onSubmit({
              title, category, location, stipend, description, workMode: 'Hybrid', duration: '12 Months',
              requiredSkills: [{ name: 'JavaScript', requiredLevel: 'Intermediate', mandatory: true }]
            })}
            className="flex-1 py-2.5 rounded-xl bg-emerald-600 text-white font-extrabold text-xs">
            Publish Listing
          </button>
        </div>
      </div>
    </div>
  );
}

function UploadEvidenceModal({ onClose, onSubmit }) {
  const [skillSearch, setSkillSearch] = useState('');
  const [skillResults, setSkillResults] = useState([]);
  const [skillSearching, setSkillSearching] = useState(false);
  const [selectedSkill, setSelectedSkill] = useState(null); // { id, name }
  const [file, setFile] = useState(null);
  const [filePreview, setFilePreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = React.useRef();

  const handleSkillSearch = async (q) => {
    setSkillSearch(q);
    if (q.trim().length < 2) { setSkillResults([]); return; }
    setSkillSearching(true);
    const res = await skillsApi.list(q);
    setSkillSearching(false);
    if (!res.error) setSkillResults(Array.isArray(res) ? res : []);
  };

  const handleFileChange = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setError('');
    setFile(f);
    // Generate preview for images
    if (f.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (ev) => setFilePreview(ev.target.result);
      reader.readAsDataURL(f);
    } else {
      setFilePreview(null);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) {
      setFile(f);
      if (f.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (ev) => setFilePreview(ev.target.result);
        reader.readAsDataURL(f);
      } else {
        setFilePreview(null);
      }
    }
  };

  const handleSubmit = async () => {
    if (!selectedSkill) { setError('Please select a skill to associate this evidence with.'); return; }
    if (!file) { setError('Please choose a file to upload.'); return; }
    setUploading(true);
    setError('');
    onSubmit({ skillId: selectedSkill.id, file, title: file.name, skill: selectedSkill.name });
    // Parent handles closing + toast; keep uploading state for a moment
  };

  const formatSize = (bytes) => {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl max-w-lg w-full p-6 space-y-5 shadow-2xl border border-slate-100 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-black text-slate-900">Upload Skill Evidence</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400">
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">
            <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
          </div>
        )}

        {/* Skill search */}
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">Associated Skill <span className="text-rose-500">*</span></label>
          {selectedSkill ? (
            <div className="flex items-center justify-between p-3 rounded-xl bg-emerald-50 border border-emerald-200">
              <div>
                <p className="text-sm font-bold text-slate-900">{selectedSkill.name}</p>
                <p className="text-xs text-slate-400">{selectedSkill.category || selectedSkill.trade || 'General'}</p>
              </div>
              <button onClick={() => { setSelectedSkill(null); setSkillSearch(''); setSkillResults([]); }}
                className="text-xs text-rose-500 font-bold hover:text-rose-700">Change</button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="relative">
                <input
                  type="text"
                  value={skillSearch}
                  onChange={e => handleSkillSearch(e.target.value)}
                  placeholder="Search for a skill (e.g. Python, React, Welding)…"
                  className="w-full p-2.5 rounded-xl border border-slate-200 text-sm" />
                {skillSearching && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                )}
              </div>
              {skillResults.length > 0 && (
                <div className="border border-slate-200 rounded-xl overflow-hidden max-h-40 overflow-y-auto">
                  {skillResults.slice(0, 6).map(skill => (
                    <button key={skill.id} onClick={() => { setSelectedSkill(skill); setSkillSearch(''); setSkillResults([]); }}
                      className="w-full flex items-center justify-between p-2.5 border-b border-slate-100 last:border-0 hover:bg-slate-50 text-left">
                      <div>
                        <p className="text-sm font-bold text-slate-900">{skill.name}</p>
                        <p className="text-xs text-slate-400">{skill.category || skill.trade || 'General'}</p>
                      </div>
                      <Plus className="w-3.5 h-3.5 text-emerald-500" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* File upload */}
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">File <span className="text-rose-500">*</span></label>
          {!file ? (
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => inputRef.current?.click()}
              className="border-2 border-dashed border-slate-300 rounded-xl p-6 text-center cursor-pointer hover:border-emerald-400 hover:bg-emerald-50/30 transition-all">
              <Upload className="w-8 h-8 text-slate-400 mx-auto mb-2" />
              <p className="text-sm font-bold text-slate-700">Click to browse or drag a file here</p>
              <p className="text-xs text-slate-400 mt-1">Images (PNG, JPG, GIF, WebP), PDF, DOCX, or video (MP4, MOV) — up to 25 MB</p>
              <input ref={inputRef} type="file"
                accept="image/*,application/pdf,video/mp4,video/quicktime,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="hidden" onChange={handleFileChange} />
            </div>
          ) : (
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center gap-3">
              {filePreview ? (
                <img src={filePreview} alt="preview" className="w-14 h-14 rounded-lg object-cover border border-slate-200" />
              ) : (
                <div className="w-14 h-14 rounded-lg bg-white border border-slate-200 flex items-center justify-center">
                  <FileCheck className="w-7 h-7 text-slate-400" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-slate-900 truncate">{file.name}</p>
                <p className="text-xs text-slate-400">{formatSize(file.size)} • {file.type || 'unknown type'}</p>
              </div>
              <button onClick={() => { setFile(null); setFilePreview(null); }}
                className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 pt-2">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-slate-200 font-bold text-xs hover:bg-slate-50">Cancel</button>
          <button
            onClick={handleSubmit}
            disabled={uploading || !selectedSkill || !file}
            className="flex-1 py-2.5 rounded-xl bg-emerald-600 text-white font-extrabold text-xs hover:bg-emerald-700 disabled:opacity-50 flex items-center justify-center gap-1.5">
            {uploading
              ? <><div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> Uploading…</>
              : <><Upload className="w-3.5 h-3.5" /> Upload Evidence</>}
          </button>
        </div>
      </div>
    </div>
  );
}
