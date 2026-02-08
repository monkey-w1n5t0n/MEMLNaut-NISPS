add_executable(nisps_test main.cpp)
target_link_libraries(nisps_test PRIVATE nisps)
add_test(NAME nisps_test COMMAND nisps_test)
