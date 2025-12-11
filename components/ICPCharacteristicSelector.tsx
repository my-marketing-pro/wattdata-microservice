'use client';

import { useState, useEffect, useMemo } from 'react';
import { ICPAttribute } from '@/lib/csv-processor';

interface ICPCharacteristicSelectorProps {
  attributes: ICPAttribute[];
  onAttributesChange: (attributes: ICPAttribute[]) => void;
  onSearch: (selectedAttributes: ICPAttribute[]) => void;
  isSearching?: boolean;
  onEstimateAudience?: (selectedAttributes: ICPAttribute[]) => Promise<number | null>;
}

interface SavedProfile {
  id: string;
  name: string;
  selectedAttributeKeys: string[]; // Store attribute keys (attributeName=attributeValue)
  createdAt: number;
}

// Category configuration with display order and colors
const CATEGORY_CONFIG: Record<string, { label: string; color: string; order: number }> = {
  'lifestyle': { label: 'Lifestyle', color: 'emerald', order: 1 },
  'interest': { label: 'Interests', color: 'blue', order: 2 },
  'financial': { label: 'Financial', color: 'amber', order: 3 },
  'demographic': { label: 'Demographics', color: 'purple', order: 4 },
  'household': { label: 'Household', color: 'rose', order: 5 },
  'purchase': { label: 'Purchases', color: 'amber', order: 6 },
  'donation': { label: 'Donations', color: 'emerald', order: 7 },
  'political': { label: 'Political', color: 'blue', order: 8 },
  'technology': { label: 'Technology', color: 'purple', order: 9 },
  'vehicle': { label: 'Vehicle', color: 'gray', order: 10 },
  'property': { label: 'Property', color: 'rose', order: 11 },
  'health': { label: 'Health', color: 'emerald', order: 12 },
  'travel': { label: 'Travel', color: 'blue', order: 13 },
  'retail': { label: 'Retail', color: 'amber', order: 14 },
  'general': { label: 'General', color: 'gray', order: 99 },
};

export default function ICPCharacteristicSelector({
  attributes,
  onAttributesChange,
  onSearch,
  isSearching = false,
  onEstimateAudience,
}: ICPCharacteristicSelectorProps) {
  const [showNegative, setShowNegative] = useState(false);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string> | null>(null); // null = not initialized
  const [savedProfiles, setSavedProfiles] = useState<SavedProfile[]>([]);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');
  const [audienceEstimate, setAudienceEstimate] = useState<number | null>(null);
  const [isEstimating, setIsEstimating] = useState(false);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [hasModifiedProfile, setHasModifiedProfile] = useState(false);

  // Load saved profiles from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('icpProfiles');
    if (saved) {
      try {
        setSavedProfiles(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to load saved profiles:', e);
      }
    }
  }, []);

  // Save profiles to localStorage when they change
  useEffect(() => {
    localStorage.setItem('icpProfiles', JSON.stringify(savedProfiles));
  }, [savedProfiles]);

  // Determine if an attribute is "negative" (false values only)
  const isNegativeAttribute = (attr: ICPAttribute): boolean => {
    const value = attr.attributeValue.toLowerCase();
    return value === 'false';
  };

  // Filter and group attributes
  const { groupedAttributes, allCategoryKeys } = useMemo(() => {
    // Filter based on showNegative toggle
    // When showNegative is OFF, show only positive attributes (not false)
    // When showNegative is ON, show only negative attributes (false)
    const filtered = showNegative
      ? attributes.filter(attr => isNegativeAttribute(attr))
      : attributes.filter(attr => !isNegativeAttribute(attr));

    // Group by category
    const groups: Record<string, { attrs: Array<{ attr: ICPAttribute; originalIndex: number }>; config: typeof CATEGORY_CONFIG[string] }> = {};

    filtered.forEach((attr) => {
      const categoryKey = getAttributeCategoryKey(attr.attributeName);

      if (!groups[categoryKey]) {
        groups[categoryKey] = {
          attrs: [],
          config: CATEGORY_CONFIG[categoryKey] || CATEGORY_CONFIG['general'],
        };
      }

      // Find original index in the full attributes array
      const originalIndex = attributes.findIndex(a => a.attribute === attr.attribute);
      groups[categoryKey].attrs.push({ attr, originalIndex });
    });

    // Sort groups by order
    const sortedGroups = Object.entries(groups)
      .sort(([, a], [, b]) => a.config.order - b.config.order);

    return {
      groupedAttributes: sortedGroups,
      allCategoryKeys: sortedGroups.map(([key]) => key),
    };
  }, [attributes, showNegative]);

  // Initialize collapsed categories to all collapsed on first render
  useEffect(() => {
    if (collapsedCategories === null && allCategoryKeys.length > 0) {
      setCollapsedCategories(new Set(allCategoryKeys));
    }
  }, [allCategoryKeys, collapsedCategories]);

  const selectedAttributes = useMemo(() => attributes.filter(a => a.selected), [attributes]);
  const selectedCount = selectedAttributes.length;

  // Create a stable key for selected attributes to avoid infinite loops
  const selectedKey = useMemo(() =>
    selectedAttributes.map(a => `${a.attributeName}=${a.attributeValue}`).sort().join('|'),
    [selectedAttributes]
  );

  // Estimate audience when selection changes
  useEffect(() => {
    if (selectedCount === 0) {
      setAudienceEstimate(null);
      return;
    }

    // Debounce the estimation
    const timer = setTimeout(async () => {
      if (onEstimateAudience && selectedCount > 0) {
        setIsEstimating(true);
        try {
          const estimate = await onEstimateAudience(selectedAttributes);
          setAudienceEstimate(estimate);
        } catch (e) {
          console.error('Failed to estimate audience:', e);
        } finally {
          setIsEstimating(false);
        }
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [selectedKey, onEstimateAudience]); // Use stable key instead of array reference

  const handleCheckboxChange = (originalIndex: number, checked: boolean) => {
    const updated = [...attributes];
    updated[originalIndex] = { ...updated[originalIndex], selected: checked };
    onAttributesChange(updated);
    // Mark as modified if we have an active profile
    if (activeProfileId) {
      setHasModifiedProfile(true);
    }
  };

  const handleOperatorChange = (originalIndex: number, operator: 'AND' | 'OR') => {
    const updated = [...attributes];
    updated[originalIndex] = { ...updated[originalIndex], operator };
    onAttributesChange(updated);
    // Mark as modified if we have an active profile
    if (activeProfileId) {
      setHasModifiedProfile(true);
    }
  };

  const handleSelectAllVisible = () => {
    const updated = [...attributes];
    groupedAttributes.forEach(([, group]) => {
      group.attrs.forEach(({ originalIndex }) => {
        updated[originalIndex] = { ...updated[originalIndex], selected: true };
      });
    });
    onAttributesChange(updated);
  };

  const handleSelectNone = () => {
    const updated = attributes.map(attr => ({ ...attr, selected: false }));
    onAttributesChange(updated);
  };

  const handleSetAllOperators = (operator: 'AND' | 'OR') => {
    const updated = attributes.map(attr => ({ ...attr, operator }));
    onAttributesChange(updated);
  };

  const toggleCategory = (category: string) => {
    setCollapsedCategories(prev => {
      const newSet = new Set(prev || []);
      if (newSet.has(category)) {
        newSet.delete(category);
      } else {
        newSet.add(category);
      }
      return newSet;
    });
  };

  // Save current selection as a profile
  const handleSaveProfile = () => {
    if (!newProfileName.trim()) return;

    const newProfile: SavedProfile = {
      id: Date.now().toString(),
      name: newProfileName.trim(),
      selectedAttributeKeys: selectedAttributes.map(a => `${a.attributeName}=${a.attributeValue}`),
      createdAt: Date.now(),
    };

    setSavedProfiles(prev => [...prev, newProfile]);
    setNewProfileName('');
    setShowSaveDialog(false);
  };

  // Load a saved profile
  const handleLoadProfile = (profile: SavedProfile) => {
    const updated = attributes.map(attr => {
      const key = `${attr.attributeName}=${attr.attributeValue}`;
      return { ...attr, selected: profile.selectedAttributeKeys.includes(key) };
    });
    onAttributesChange(updated);
    setActiveProfileId(profile.id);
    setHasModifiedProfile(false);
  };

  // Update the active profile with current selections
  const handleUpdateProfile = () => {
    if (!activeProfileId) return;

    setSavedProfiles(prev => prev.map(p => {
      if (p.id === activeProfileId) {
        return {
          ...p,
          selectedAttributeKeys: selectedAttributes.map(a => `${a.attributeName}=${a.attributeValue}`),
        };
      }
      return p;
    }));
    setHasModifiedProfile(false);
  };

  // Delete a saved profile
  const handleDeleteProfile = (profileId: string) => {
    setSavedProfiles(prev => prev.filter(p => p.id !== profileId));
    if (activeProfileId === profileId) {
      setActiveProfileId(null);
      setHasModifiedProfile(false);
    }
  };

  // Get the position of an attribute among selected attributes (for showing operator)
  const getSelectedPosition = (attr: ICPAttribute): number => {
    let position = 0;
    for (const a of attributes) {
      if (a.selected) {
        position++;
        if (a.attribute === attr.attribute) break;
      }
    }
    return position;
  };

  // Get active profile name
  const activeProfile = savedProfiles.find(p => p.id === activeProfileId);

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Audience Estimate Card - prominent at top */}
      <div className="flex-shrink-0 bg-gradient-to-br from-purple-600 to-indigo-600 rounded-xl p-3 text-white shadow-lg">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-purple-200 text-xs font-medium uppercase tracking-wide">Est. Audience</p>
            {isEstimating ? (
              <p className="text-xl font-bold animate-pulse">...</p>
            ) : audienceEstimate !== null ? (
              <p className="text-2xl font-bold">{audienceEstimate.toLocaleString()}</p>
            ) : (
              <p className="text-xl font-bold text-purple-300">{selectedCount > 0 ? '—' : '0'}</p>
            )}
          </div>
          <div className="text-right">
            <p className="text-purple-200 text-xs">Selected</p>
            <p className="text-lg font-semibold">{selectedCount}</p>
          </div>
        </div>
      </div>

      {/* Saved Profiles Card */}
      {(savedProfiles.length > 0 || selectedCount > 0) && (
        <div className="flex-shrink-0 bg-white/60 backdrop-blur-sm rounded-xl border border-purple-100 overflow-hidden">
          <div className="px-3 py-2 bg-purple-50/50 border-b border-purple-100">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-purple-800 uppercase tracking-wide">
                Saved Profiles
              </span>
              {selectedCount > 0 && !showSaveDialog && (
                <button
                  onClick={() => setShowSaveDialog(true)}
                  className="text-xs text-purple-600 hover:text-purple-800 font-medium flex items-center gap-1 transition-colors"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Save Current
                </button>
              )}
            </div>
          </div>

          <div className="p-2">
            {/* Save Profile Dialog */}
            {showSaveDialog && (
              <div className="mb-2 p-2 bg-gradient-to-r from-emerald-50 to-green-50 rounded-lg border border-emerald-200">
                <input
                  type="text"
                  value={newProfileName}
                  onChange={(e) => setNewProfileName(e.target.value)}
                  placeholder="Enter profile name..."
                  className="w-full px-3 py-2 text-sm text-gray-900 bg-white border border-emerald-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent placeholder-gray-400"
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveProfile()}
                  autoFocus
                />
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={handleSaveProfile}
                    disabled={!newProfileName.trim()}
                    className="flex-1 px-3 py-1.5 text-xs font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                  >
                    Save Profile
                  </button>
                  <button
                    onClick={() => { setShowSaveDialog(false); setNewProfileName(''); }}
                    className="px-3 py-1.5 text-xs font-medium bg-white text-gray-600 rounded-lg hover:bg-gray-100 border border-gray-200 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Profile chips */}
            {savedProfiles.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {savedProfiles.map(profile => {
                  const isActive = profile.id === activeProfileId;
                  return (
                    <div
                      key={profile.id}
                      className={`group flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-all cursor-pointer ${
                        isActive
                          ? 'bg-purple-600 text-white shadow-md ring-2 ring-purple-300'
                          : 'bg-purple-100 text-purple-700 hover:bg-purple-200'
                      }`}
                      onClick={() => handleLoadProfile(profile)}
                    >
                      <span>{profile.name}</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteProfile(profile.id); }}
                        className={`ml-0.5 rounded-full p-0.5 transition-all ${
                          isActive
                            ? 'text-purple-200 hover:text-white hover:bg-purple-500'
                            : 'text-purple-400 hover:text-red-600 hover:bg-red-100 opacity-0 group-hover:opacity-100'
                        }`}
                        title="Delete profile"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-gray-400 text-center py-2">No saved profiles yet</p>
            )}

            {/* Update Profile Banner */}
            {activeProfileId && hasModifiedProfile && (
              <div className="mt-2 p-2 bg-amber-50 rounded-lg border border-amber-200 flex items-center justify-between">
                <span className="text-xs text-amber-700 font-medium">
                  &ldquo;{activeProfile?.name}&rdquo; modified
                </span>
                <div className="flex gap-1.5">
                  <button
                    onClick={handleUpdateProfile}
                    className="px-2.5 py-1 text-xs font-medium bg-amber-500 text-white rounded-md hover:bg-amber-600 transition-colors"
                  >
                    Update
                  </button>
                  <button
                    onClick={() => { setActiveProfileId(null); setHasModifiedProfile(false); }}
                    className="px-2.5 py-1 text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors"
                  >
                    Discard
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Characteristics Controls Card */}
      <div className="flex-shrink-0 bg-white/60 backdrop-blur-sm rounded-xl border border-gray-200 overflow-hidden">
        {/* Header */}
        <div className="px-3 py-2 bg-gray-50/80 border-b border-gray-200">
          <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Characteristics</span>
        </div>

        <div className="p-3 space-y-3">
          {/* View Toggle */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500 font-medium">View</span>
            <div className="flex bg-gray-100 rounded-lg p-0.5">
              <button
                onClick={() => setShowNegative(false)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                  !showNegative
                    ? 'bg-white text-gray-800 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Positive
              </button>
              <button
                onClick={() => setShowNegative(true)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                  showNegative
                    ? 'bg-white text-gray-800 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Negative
              </button>
            </div>
          </div>

          {/* Selection Controls */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500 font-medium">Selection</span>
            <div className="flex gap-1.5">
              <button
                onClick={handleSelectAllVisible}
                className="px-3 py-1.5 text-xs font-medium bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 transition-colors"
              >
                Select All
              </button>
              <button
                onClick={handleSelectNone}
                className="px-3 py-1.5 text-xs font-medium bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors"
              >
                Clear
              </button>
            </div>
          </div>

          {/* Operator Controls */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500 font-medium">Operators</span>
            <div className="flex gap-1.5">
              <button
                onClick={() => handleSetAllOperators('AND')}
                className="px-3 py-1.5 text-xs font-medium bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition-colors"
              >
                All AND
              </button>
              <button
                onClick={() => handleSetAllOperators('OR')}
                className="px-3 py-1.5 text-xs font-medium bg-orange-100 text-orange-700 rounded-lg hover:bg-orange-200 transition-colors"
              >
                All OR
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Grouped attribute list */}
      <div className="flex-1 overflow-y-auto min-h-0 space-y-2 pr-1">
        {groupedAttributes.map(([categoryKey, group]) => {
          const isCollapsed = collapsedCategories?.has(categoryKey) ?? true; // Default to collapsed
          const categorySelectedCount = group.attrs.filter(({ attr }) => attr.selected).length;
          const colorClass = getCategoryColorClass(group.config.color);

          return (
            <div key={categoryKey} className="bg-white/60 backdrop-blur-sm rounded-xl border border-gray-200 overflow-hidden shadow-sm">
              {/* Category header */}
              <button
                onClick={() => toggleCategory(categoryKey)}
                className={`w-full flex items-center justify-between px-3 py-2 ${colorClass.bg} ${colorClass.text} text-xs font-semibold transition-all hover:opacity-90`}
              >
                <span className="flex items-center gap-2">
                  <svg
                    className={`w-3.5 h-3.5 transition-transform duration-200 ${isCollapsed ? '' : 'rotate-90'}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                  {group.config.label}
                </span>
                <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${colorClass.badge}`}>
                  {categorySelectedCount}/{group.attrs.length}
                </span>
              </button>

              {/* Category items */}
              {!isCollapsed && (
                <div className="p-2 space-y-1.5 bg-white/80">
                  {group.attrs.map(({ attr, originalIndex }) => {
                    const selectedPosition = getSelectedPosition(attr);
                    const showOperator = attr.selected && selectedPosition < selectedCount;
                    const { label } = formatAttributeLabel(attr.attributeName, attr.attributeValue);
                    const isPositive = !isNegativeAttribute(attr);

                    return (
                      <div key={attr.attribute}>
                        <label
                          className={`flex items-start gap-2.5 p-2 rounded-lg cursor-pointer transition-all ${
                            attr.selected
                              ? 'bg-purple-100 border border-purple-300 shadow-sm'
                              : 'bg-gray-50/80 border border-transparent hover:bg-gray-100 hover:border-gray-200'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={attr.selected}
                            onChange={(e) => handleCheckboxChange(originalIndex, e.target.checked)}
                            className="h-4 w-4 mt-0.5 text-purple-600 rounded border-gray-300 focus:ring-purple-500 focus:ring-offset-0 flex-shrink-0"
                          />
                          <div className="flex-1 min-w-0">
                            <div className={`text-sm leading-snug break-words ${isPositive ? 'text-gray-800' : 'text-gray-500'}`}>
                              {label}
                            </div>
                            <div className="text-xs text-gray-400 mt-0.5">
                              {attr.percentage.toFixed(0)}% of contacts ({attr.count})
                            </div>
                          </div>
                        </label>

                        {showOperator && (
                          <div className="flex items-center justify-center py-1">
                            <select
                              value={attr.operator}
                              onChange={(e) => handleOperatorChange(originalIndex, e.target.value as 'AND' | 'OR')}
                              className={`text-xs font-medium rounded-full px-3 py-1 border-0 cursor-pointer transition-colors ${
                                attr.operator === 'AND'
                                  ? 'bg-blue-100 text-blue-700'
                                  : 'bg-orange-100 text-orange-700'
                              }`}
                            >
                              <option value="AND">AND</option>
                              <option value="OR">OR</option>
                            </select>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Search button */}
      <div className="flex-shrink-0 mt-3 pt-3">
        <button
          onClick={() => onSearch(selectedAttributes)}
          disabled={selectedCount === 0 || isSearching}
          className="w-full py-3 bg-gradient-to-r from-purple-600 to-indigo-600 text-white text-sm rounded-xl font-semibold
                     hover:from-purple-700 hover:to-indigo-700 disabled:from-gray-300 disabled:to-gray-400 disabled:cursor-not-allowed
                     transition-all shadow-lg hover:shadow-xl disabled:shadow-none flex items-center justify-center gap-2"
        >
          {isSearching ? (
            <>
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Searching...
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              Find Similar Contacts
            </>
          )}
        </button>
      </div>
    </div>
  );
}

/**
 * Get the category key from an attribute name (returns lowercase key for grouping)
 */
function getAttributeCategoryKey(name: string): string {
  const parts = name.toLowerCase().split('_');
  const validCategories = [
    'financial', 'lifestyle', 'interest', 'demographic', 'household',
    'purchase', 'donation', 'political', 'technology', 'vehicle',
    'property', 'health', 'travel', 'retail'
  ];

  if (parts[0] && validCategories.includes(parts[0])) {
    // Map 'interest' to 'interests' for consistency with CATEGORY_CONFIG
    if (parts[0] === 'interest') return 'interest';
    if (parts[0] === 'demographic') return 'demographic';
    return parts[0];
  }
  return 'general';
}

/**
 * Get Tailwind color classes for a category
 */
function getCategoryColorClass(color: string): { bg: string; text: string; badge: string } {
  const colors: Record<string, { bg: string; text: string; badge: string }> = {
    emerald: { bg: 'bg-emerald-100', text: 'text-emerald-800', badge: 'bg-emerald-200 text-emerald-700' },
    blue: { bg: 'bg-blue-100', text: 'text-blue-800', badge: 'bg-blue-200 text-blue-700' },
    amber: { bg: 'bg-amber-100', text: 'text-amber-800', badge: 'bg-amber-200 text-amber-700' },
    purple: { bg: 'bg-purple-100', text: 'text-purple-800', badge: 'bg-purple-200 text-purple-700' },
    rose: { bg: 'bg-rose-100', text: 'text-rose-800', badge: 'bg-rose-200 text-rose-700' },
    gray: { bg: 'bg-gray-100', text: 'text-gray-800', badge: 'bg-gray-200 text-gray-700' },
  };
  return colors[color] || colors.gray;
}

/**
 * Formats an attribute name and value into a human-friendly label.
 */
function formatAttributeLabel(name: string, value: string): { category: string; label: string } {
  // Handle object values that weren't properly stringified
  let displayValue = value;
  if (typeof value === 'object' && value !== null) {
    try {
      displayValue = JSON.stringify(value);
    } catch {
      displayValue = String(value);
    }
  }

  const isFalse = displayValue.toLowerCase() === 'false';
  const isTrue = displayValue.toLowerCase() === 'true';
  const isBoolean = isFalse || isTrue;

  const parts = name.toLowerCase().split('_');

  const categoryMap: Record<string, string> = {
    'financial': 'Financial',
    'lifestyle': 'Lifestyle',
    'interest': 'Interests',
    'demographic': 'Demographics',
    'household': 'Household',
    'purchase': 'Purchases',
    'donation': 'Donations',
    'political': 'Political',
    'technology': 'Technology',
    'vehicle': 'Vehicle',
    'property': 'Property',
    'health': 'Health',
    'travel': 'Travel',
    'retail': 'Retail',
  };

  let category = 'General';
  let remainingParts = [...parts];

  if (parts[0] && categoryMap[parts[0]]) {
    category = categoryMap[parts[0]];
    remainingParts = parts.slice(1);
  }

  const suffixesToRemove = ['value', 'flag', 'indicator', 'code'];
  while (remainingParts.length > 0 && suffixesToRemove.includes(remainingParts[remainingParts.length - 1])) {
    remainingParts.pop();
  }

  let label = '';

  if (remainingParts[0] === 'is') {
    const thing = formatWords(remainingParts.slice(1));
    if (isBoolean) {
      label = isFalse ? `Not a ${thing.toLowerCase()}` : `Is a ${thing.toLowerCase()}`;
    } else {
      label = `${thing}: ${displayValue}`;
    }
  } else if (remainingParts[0] === 'has') {
    const thing = formatWords(remainingParts.slice(1));
    if (isBoolean) {
      label = isFalse ? `No ${thing.toLowerCase()}` : `Has ${thing.toLowerCase()}`;
    } else {
      label = `${thing}: ${displayValue}`;
    }
  } else if (remainingParts[0] === 'owns') {
    const thing = formatWords(remainingParts.slice(1));
    if (isBoolean) {
      label = isFalse ? `Doesn't own ${thing.toLowerCase()}` : `Owns ${thing.toLowerCase()}`;
    } else {
      label = `${thing}: ${displayValue}`;
    }
  } else if (remainingParts[0] === 'donated') {
    const cause = formatWords(remainingParts.slice(1));
    if (isBoolean) {
      label = isFalse ? `Doesn't donate to ${cause.toLowerCase()}` : `Donates to ${cause.toLowerCase()}`;
    } else {
      label = `Donated to ${cause}: ${displayValue}`;
    }
  } else if (remainingParts[0] === 'interested') {
    const interest = formatWords(remainingParts.slice(1));
    if (isBoolean) {
      label = isFalse ? `Not interested in ${interest.toLowerCase()}` : `Interested in ${interest.toLowerCase()}`;
    } else {
      label = `Interest in ${interest}: ${displayValue}`;
    }
  } else if (remainingParts[0] === 'buyer' || remainingParts[0] === 'purchaser') {
    const thing = formatWords(remainingParts.slice(1));
    if (isBoolean) {
      label = isFalse ? `Doesn't buy ${thing.toLowerCase()}` : `Buys ${thing.toLowerCase()}`;
    } else {
      label = `${formatWords(remainingParts)}: ${displayValue}`;
    }
  } else if (remainingParts[0] === 'subscriber') {
    const thing = formatWords(remainingParts.slice(1));
    if (isBoolean) {
      label = isFalse ? `Not subscribed to ${thing.toLowerCase()}` : `Subscribed to ${thing.toLowerCase()}`;
    } else {
      label = `${formatWords(remainingParts)}: ${displayValue}`;
    }
  } else if (remainingParts[0] === 'member') {
    const thing = formatWords(remainingParts.slice(1));
    if (isBoolean) {
      label = isFalse ? `Not a ${thing.toLowerCase()} member` : `${thing} member`;
    } else {
      label = `${formatWords(remainingParts)}: ${displayValue}`;
    }
  } else {
    const formattedName = formatWords(remainingParts);
    if (isBoolean) {
      label = isFalse ? `No ${formattedName.toLowerCase()}` : formattedName;
    } else {
      label = `${formattedName}: ${displayValue}`;
    }
  }

  return { category, label };
}

function formatWords(words: string[]): string {
  if (words.length === 0) return '';

  const replacements: Record<string, string> = {
    'amex': 'Amex',
    'cc': 'Credit Card',
    'hh': 'Household',
    'hhi': 'Household Income',
    'tv': 'TV',
    'dvd': 'DVD',
    'cd': 'CD',
    'pc': 'PC',
    'suv': 'SUV',
    'rv': 'RV',
    'atv': 'ATV',
    'diy': 'DIY',
    'bbq': 'BBQ',
    'nfl': 'NFL',
    'nba': 'NBA',
    'mlb': 'MLB',
    'nhl': 'NHL',
    'usa': 'USA',
    'uk': 'UK',
    '401k': '401k',
    'ira': 'IRA',
  };

  return words
    .map(word => {
      const lower = word.toLowerCase();
      if (replacements[lower]) return replacements[lower];
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ')
    .replace(/\bAnd\b/g, '&')
    .replace(/\bOr\b/g, '/')
    .replace(/\s+/g, ' ')
    .trim();
}
