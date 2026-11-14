from types import SimpleNamespace
from app.services.matching_service import calculate_match, level_weight

def test_verified_skill_gets_full_weight():
    candidate=SimpleNamespace(education="BTech",interests="software",location="Delhi",experience="python")
    listing=SimpleNamespace(location="Delhi",education_requirement="BTech",interest_keywords="software",experience_requirement="python")
    req=[SimpleNamespace(skill_id=1,required_level="advanced")]
    cs=[SimpleNamespace(skill_id=1,level="advanced",verified=True)]
    result=calculate_match(candidate,listing,req,cs,[],[])
    assert result["eligible"] is True
    assert result["components"]["skill_match"]==100.0
    assert result["score"]==100.0

def test_level_weight_partial():
    assert level_weight("intermediate", "advanced") == 0.75
    assert level_weight("beginner", "advanced") == 0.5
    assert level_weight(None, "advanced") == 0.0

def test_missing_mandatory_certificate_makes_ineligible():
    candidate=SimpleNamespace(education=None,interests=None,location=None,experience=None)
    listing=SimpleNamespace(location=None,education_requirement=None,interest_keywords=None,experience_requirement=None)
    result=calculate_match(candidate,listing,[],[],[7],[])
    assert result["eligible"] is False
    assert result["hard_failures"][0]["certification_id"] == 7
